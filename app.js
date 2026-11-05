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
   12. Screen flow and event wiring
   -------------------------------------------------------------------------- */
/* --------------------------------------------------------------------------
   v2.89.0: passage encryption (Evernote's encrypted text,
   Chris's design as approved 2026-11-02).

   Selected text in a note can be encrypted under ONE
   passphrase for everything. The cryptography is
   WebCrypto only, on this device:

   - At setup a random 256 bit vault key is generated.
     The passphrase derives a key encryption key through
     PBKDF2-HMAC-SHA-256 (600000 iterations, a random
     16 byte salt), and the vault key is wrapped with
     AES-GCM under it. The wrapping record {version,
     kdfSalt, kdfIterations, wrappedKey{iv, data}} lives
     in index.json (state.encryption, plumbed through
     buildIndexObject, the folder rebuild, both index
     load branches, and the cache snapshot like every
     other index field) and holds nothing secret shaped:
     the passphrase and the unwrapped vault key live
     only in this page's memory, and only while
     unlocked. A successful AES-GCM unwrap IS the
     passphrase check; a wrong passphrase fails it and
     changes no state.
   - Each passage is encrypted with the vault key
     directly, AES-GCM with a fresh random 12 byte IV
     per encryption, its inner HTML as the plaintext,
     so formatting round trips exactly. In a stored
     body a passage is one atomic span.ssenc-block
     (contenteditable false) carrying data-ssenc="1"
     and the base64url iv and ciphertext in data
     attributes, its face reading "Encrypted text".
     Locked passages contribute no text to previews or
     search (htmlToText strips them), are opaque to
     sync, conflict copies, versions, and the drop box,
     and are never decrypted anywhere but this editor.
   - While unlocked, a passage in the open note is
     decrypted in place into a span.ssenc-open region
     (visually distinct, with a lock chip at its head
     that locks the vault again). Since v2.91.0 the
     decrypted fragment can hold whole runs of blocks,
     and such a region stands as a block of its own
     (the ssenc-open-blocks class) wherever the locked
     block stood. The region element
     carries the passage's latest ciphertext in its own
     data-ssenc-iv and data-ssenc-ct attributes, kept
     current by an encryption chain that re-encrypts
     the region's HTML as it is edited, and
     collectEditor serializes a CLONE in which every
     region is replaced by its locked block, so no
     save, snapshot comparison, export, or move can
     ever write a decrypted passage. runEditorAutosave
     additionally awaits ssencFlushEditorRegions before
     it collects, so the ciphertext a save writes is
     the region's current text, not a stale snapshot.
   - The vault locks when the Settings duration
     expires (the timer runs from the unlock moment),
     on sign out (always, immediately), and from the
     manual Lock control in Settings. Locking first
     re-encrypts the open note's regions in place,
     then clears the key. The duration is a per device
     setting (state.ssencUnlockChoice): 10, 15, 30
     (the default), 60, or 120 minutes, or "close"
     (until the app or window closes, no timer).
   - This version has NO recovery: a forgotten
     passphrase loses the encrypted text. The setup
     dialog says so in plain words before anything is
     created. (Chris directed that a recovery option
     be designed for the NEXT version; nothing of it
     is prebuilt here.) Whole note encryption,
     encrypted attachments, a passphrase change
     control, and hidden titles are likewise out of
     scope; note titles stay visible as always.

   Refusal rule for the Encrypt action (v2.91.0,
   widened on Chris's direction from the v2.89.0
   one paragraph rule he rejected: "Any text, with
   any format anywhere in the note needs to be able
   to be encrypted"): the Encrypt action takes the
   selection's exact HTML fragment with NO structural
   restriction, across any blocks and structures in
   the note body. The refusals are no selection (or
   a collapsed caret), a selection outside the note
   body, a selection in the title field (encryption
   is body only; titles stay visible), and, since
   v2.93.0 on Chris's direction, any selection
   touching a locked block or an open decrypted
   region: already encrypted text cannot be
   encrypted again, so the v2.91.0 nested carrying
   of a caught block and subsuming of a caught
   region are removed. Since v2.91.0 a decrypted
   region can wrap whole runs of blocks, and
   collect/save re-encrypts a region's full inner
   HTML from wherever the region sits in the body
   tree.

   v2.93.0 also adds the Remove encryption control
   to every locked block's face (beside the lock
   icon): it strips that one passage's encryption
   permanently, leaving its content as ordinary
   note text (that flow of the control's is
   removed in v2.98.0; see the paragraph at the
   end of this header), and the Unlock dialog's
   Enter key now submits through its form, exactly
   as its button does.

   v2.94.0 adds the recovery key Chris approved,
   superseding the no recovery paragraph above:
   the vault key gains a second wrapper, under a
   key derived from a 32 character recovery code
   (see the recovery section below). The record's
   one optional recovery field holds only a salt
   and the wrapped key; the code is shown once and
   stored nowhere. Losing both the passphrase and
   the code still loses the text, by design. The
   same build makes Settings the passphrase's home
   (Chris's amendment): a Set up passphrase control
   stands there before any vault exists, the
   encrypt flow's ask at encrypt time is unchanged,
   and Change passphrase rewraps the vault key
   under a new passphrase, the recovery wrapper
   riding through untouched because the vault key
   itself does not change.
   v2.97.0 completes the Remove control's standing:
   an open decrypted region carries it too, beside
   its lock chip (see ssencBuildRegion), and using
   it there dissolves the passage through the same
   strip the locked block's control ends in (see
   ssencRemoveOpenRegionFlow). Through v2.96.0 the
   control stood on locked blocks only; Chris
   corrected that reading with a screenshot of an
   open passage offering no removal, his earlier
   words "unencrypted text blocks" having meant
   passages standing decrypted after unlock all
   along.

   v2.98.0 (Chris's direction, after testing
   v2.97.0): the Remove encryption control stands
   ONLY on an open passage. The locked block's
   face renders without it (ssencBuildBlock), a
   face saved by v2.93.0 through v2.97.0 with the
   control in its stored markup has it stripped
   on open (ssencDecorateEditorBody), so the
   note's next save drops the stale markup, and
   the locked flow and its click branch are gone:
   a locked passage is opened first and removed
   from the region, like everything else done
   with it. The same build fixes the strip's
   aim: ssencStripInsert spliced the passage out
   of its container's clone at the container's
   FIRST encrypted block, so with another block
   standing earlier in the same container the
   removal deleted that block and left the
   passage's own "Encrypted text" pill standing
   (Chris's report; the diagnosis and captured
   markup are in the build report). The block is
   now marked before the clone is taken and the
   surgery finds it by the mark, the mark a token
   unique to the strip: the proof rig caught a
   mark from an earlier strip surviving on
   another block through an undo restore and
   answering a later strip first, so no bare
   flag is ever trusted.
   -------------------------------------------------------------------------- */

const SSENC_KDF_ITERATIONS = 600000;
const SSENC_UNLOCK_CHOICES = [10, 15, 30, 60, 120, "close"];

/* The unwrapped vault key (a CryptoKey) while unlocked,
   or null. Page memory only, by design. */
let ssencKey = null;
/* The expiry timer for the standing unlock, or null
   (no timer under the "close" choice or while locked). */
let ssencUnlockTimer = null;
/* Decrypted region bookkeeping, by region id:
   {el, running, queuedHtml, chain}. The ciphertext
   itself rides the region element's data attributes;
   this map only tracks the encryption chains. */
const ssencRegions = new Map();
/* The strip target counter (v2.98.0): every
   ssencStripInsert takes the next value as its
   target block's mark, so a mark surviving from
   an earlier strip (an undo can restore a marked
   block) never answers for a later strip. */
let ssencStripTargetSeq = 0;
let ssencRegionSeq = 0;
/* The resolver of the setup or unlock dialog currently
   open, or null: {kind, resolve}. One dialog at a time. */
let ssencDialogPending = null;

function ssencBytesToB64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-")
    .replace(/\//g, "_").replace(/=+$/, "");
}

function ssencB64UrlToBytes(text) {
  let b64 = String(text || "").replace(/-/g, "+")
    .replace(/_/g, "/");
  while (b64.length % 4) { b64 += "="; }
  return base64ToBytes(b64);
}

function ssencRandomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

/* The index record's sanitizer, in the house pattern:
   only the frozen shape is honored; anything damaged
   (a hand edited index, an older build's field)
   degrades to no record, which reads as "not set up"
   and can never half unlock anything. */
function sanitizeEncryptionRecord(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  if (raw.version !== 1) { return null; }
  const b64url = /^[A-Za-z0-9_-]+$/;
  if (typeof raw.kdfSalt !== "string" ||
      !b64url.test(raw.kdfSalt)) { return null; }
  const iters = Number(raw.kdfIterations);
  if (!Number.isFinite(iters) || iters < 1000 ||
      iters > 10000000) { return null; }
  const wk = raw.wrappedKey;
  if (!wk || typeof wk !== "object" ||
      typeof wk.iv !== "string" || !b64url.test(wk.iv) ||
      typeof wk.data !== "string" || !b64url.test(wk.data)) {
    return null;
  }
  const out = {
    version: 1,
    kdfSalt: raw.kdfSalt,
    kdfIterations: Math.trunc(iters),
    wrappedKey: { iv: wk.iv, data: wk.data }
  };
  /* v2.94.0: the one optional field, the recovery
     wrapper {kdfSalt, kdfIterations, wrappedKey},
     held to the same frozen shape. A record without
     it (every record written before v2.94.0) loads
     exactly as it always did; a damaged one loses
     only the field, never the record, since the
     passphrase wrapper standing beside it is still
     whole. Only the salt and the wrapped bytes are
     ever stored; the code itself is not a field
     anywhere. */
  const rc = raw.recovery;
  if (rc && typeof rc === "object" &&
      !Array.isArray(rc) &&
      typeof rc.kdfSalt === "string" &&
      b64url.test(rc.kdfSalt)) {
    const rIters = Number(rc.kdfIterations);
    const rwk = rc.wrappedKey;
    if (Number.isFinite(rIters) && rIters >= 1000 &&
        rIters <= 10000000 &&
        rwk && typeof rwk === "object" &&
        typeof rwk.iv === "string" &&
        b64url.test(rwk.iv) &&
        typeof rwk.data === "string" &&
        b64url.test(rwk.data)) {
      out.recovery = {
        kdfSalt: rc.kdfSalt,
        kdfIterations: Math.trunc(rIters),
        wrappedKey: { iv: rwk.iv, data: rwk.data }
      };
    }
  }
  return out;
}

function ssencHasRecord() {
  return !!sanitizeEncryptionRecord(state.encryption);
}

function ssencIsUnlocked() { return !!ssencKey; }

async function ssencDeriveKek(passphrase, record) {
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(String(passphrase)),
    "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: ssencB64UrlToBytes(record.kdfSalt),
      iterations: record.kdfIterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false, ["encrypt", "decrypt"]);
}

async function ssencImportVaultKey(rawBytes) {
  /* v2.94.0: extractable, because minting the
     recovery wrapper after an ordinary unlock must
     wrap this key under the recovery key's own
     derived key, and wrapping takes the raw bytes.
     The key still lives in page memory only, is
     never written anywhere, and the raw copy a mint
     makes is zeroed the moment the wrap lands. */
  return crypto.subtle.importKey("raw", rawBytes,
    { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
}

/* Encrypt one passage's HTML under the vault key.
   Resolves {iv, ct} in base64url. */
async function ssencEncryptHtml(html) {
  const iv = ssencRandomBytes(12);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv }, ssencKey,
    new TextEncoder().encode(String(html)));
  return { iv: ssencBytesToB64Url(iv),
    ct: ssencBytesToB64Url(new Uint8Array(cipher)) };
}

/* Decrypt one passage back to its HTML. Rejects when
   the ciphertext does not authenticate (tampered, or
   wrapped under another vault). */
async function ssencDecryptHtml(ivB64, ctB64) {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ssencB64UrlToBytes(ivB64) },
    ssencKey, ssencB64UrlToBytes(ctB64));
  return new TextDecoder().decode(plain);
}

/* The locked block element for one passage, the only
   shape a stored body ever carries for it. */
const SSENC_LOCK_SVG =
  "<svg viewBox=\"0 0 24 24\" width=\"13\" height=\"13\" " +
  "fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" " +
  "stroke-linecap=\"round\" stroke-linejoin=\"round\" " +
  "aria-hidden=\"true\" focusable=\"false\">" +
  "<rect x=\"4\" y=\"11\" width=\"16\" height=\"10\" rx=\"2\"/>" +
  "<path d=\"M8 11V7a4 4 0 0 1 8 0v4\"/></svg>";

/* v2.93.0: the open lock glyph for the Remove
   encryption control: the lock's own geometry with
   the shackle sprung open (it does not come back
   down on the right), in the same stroke dress. */
const SSENC_REMOVE_SVG =
  "<svg viewBox=\"0 0 24 24\" width=\"13\" height=\"13\" " +
  "fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" " +
  "stroke-linecap=\"round\" stroke-linejoin=\"round\" " +
  "aria-hidden=\"true\" focusable=\"false\">" +
  "<rect x=\"4\" y=\"11\" width=\"16\" height=\"10\" rx=\"2\"/>" +
  "<path d=\"M8 11V7a4 4 0 0 1 7.8-1.3\"/></svg>";

/* The Remove encryption control's markup: a span
   button carrying the app's tooltip convention, its
   title naming the action it runs. Since v2.98.0
   its one consumer is the open region's builder
   (ssencBuildRegion); through v2.97.0 the locked
   block's face and its decoration shared it too. */
function ssencRemoveControlHtml() {
  return "<span class=\"ssenc-remove\" role=\"button\" " +
    "aria-label=\"Remove encryption\" " +
    "title=\"Remove encryption\">" +
    SSENC_REMOVE_SVG + "</span>";
}

function ssencBuildBlock(iv, ct) {
  const block = document.createElement("span");
  block.className = "ssenc-block";
  block.setAttribute("data-ssenc", "1");
  block.setAttribute("data-ssenc-iv", iv);
  block.setAttribute("data-ssenc-ct", ct);
  block.setAttribute("contenteditable", "false");
  block.setAttribute("role", "button");
  block.setAttribute("aria-label", "Encrypted text");
  block.setAttribute("title", "Encrypted text");
  /* v2.98.0: the face carries no Remove encryption
     control (Chris's direction: the control stands
     ONLY on an open passage). Through v2.97.0 the
     control stood here too, from v2.93.0 on; a
     locked passage is now opened first, and the
     removal runs from the region's own control. */
  block.innerHTML = SSENC_LOCK_SVG +
    "<span class=\"ssenc-face-text\">Encrypted text</span>";
  return block;
}

/* The decrypted region for one passage: the passage's
   HTML in an editable, visually distinct span, headed
   by a small lock chip (runtime furniture, stripped
   before anything is encrypted or measured) whose
   click locks the vault. The region carries the
   passage's current ciphertext in its own data
   attributes, refreshed by its encryption chain, so
   collectEditor's substitution needs nothing else. */
function ssencBuildRegion(html, iv, ct) {
  ssencRegionSeq += 1;
  const rid = "ssenc-r" + ssencRegionSeq;
  const region = document.createElement("span");
  region.className = "ssenc-open";
  region.setAttribute("data-ssenc-open", "1");
  region.setAttribute("data-ssenc-rid", rid);
  region.setAttribute("data-ssenc-iv", iv);
  region.setAttribute("data-ssenc-ct", ct);
  const chip = document.createElement("span");
  chip.className = "ssenc-relock";
  chip.setAttribute("contenteditable", "false");
  chip.setAttribute("role", "button");
  chip.setAttribute("aria-label", "Lock encrypted text");
  chip.setAttribute("title", "Lock encrypted text");
  chip.innerHTML = SSENC_LOCK_SVG;
  region.appendChild(chip);
  /* v2.97.0: the Remove encryption control stands
     on the open region too, beside the lock chip
     (runtime furniture like the chip: non editable,
     and stripped from the region's HTML before
     anything is encrypted or measured, see
     ssencRegionHtml). Using it dissolves this
     passage permanently (see
     ssencRemoveOpenRegionFlow); through v2.96.0 it
     stood on locked blocks only, so a passage
     standing open offered no way to strip its
     encryption. Since v2.98.0 the control stands
     ONLY here: the locked block's face no longer
     carries it. */
  const rmHolder = document.createElement("div");
  rmHolder.innerHTML = ssencRemoveControlHtml();
  const rmCtl = rmHolder.firstChild;
  rmCtl.setAttribute("contenteditable", "false");
  region.appendChild(rmCtl);
  const holder = document.createElement("div");
  holder.innerHTML = html;
  while (holder.firstChild) {
    region.appendChild(holder.firstChild);
  }
  /* v2.91.0: a fragment holding block level markup
     (whole paragraphs, list items, a table) makes the
     region a block of its own, so the restored run
     lays out like the text it replaced instead of
     squeezing into one line. Inline only fragments
     keep the plain inline span, exactly as v2.89.0. */
  if (region.querySelector(
      "p, div, ul, ol, li, table, blockquote, pre, " +
      "h1, h2, h3, h4, h5, h6, figure, hr, section")) {
    region.classList.add("ssenc-open-blocks");
  }
  ssencRegions.set(rid, {
    el: region, running: false, queuedHtml: null,
    chain: Promise.resolve()
  });
  return region;
}


/* v2.91.0: rebind one freshly restored fragment, the
   render half of a decrypt. A restored fragment can
   hold anything a note body can (links in any view,
   tag pills, checklist items, attachment cards, a
   table of contents, a note tasks block, folded
   sections), so the region runs through the same
   render and rebind steps renderEditor runs when a
   note loads, scoped to the region: checklist
   normalization and sync, attachment placeholder
   decoration and hydration, table filters, link
   tooltips and views, task links, the table of
   contents rebuild, section folds, and the note
   tasks repaint. Without this the restored markup
   would be inert: pills that do not filter, cards
   that never fill, links that show no face. */
function ssencRebindFragment(region) {
  const note = (typeof currentNote === "function")
    ? currentNote() : null;
  if (!note) { return; }
  normalizeChecklists(region);
  syncChecklistBoxes(region);
  const attById = new Map();
  (note.attachments || []).forEach(function (a) {
    attById.set(a.id, a);
  });
  region.querySelectorAll(".ss-attachment").forEach(
    function (el) {
      decorateAttachmentPlaceholder(note, el, attById);
    });
  applyAllTableFilters(region);
  decorateLinkTooltips(region);
  decorateLinkViews(region);
  decorateTaskLinks(region);
  refreshTocBlocks(document.getElementById("noteBody"));
  decorateSectionFolds(region);
  refreshNoteTaskBlocks(region, note);
  void hydrateAttachments(note);
}

/* One region's encryptable content: its inner HTML
   with the runtime lock chip removed. */
function ssencRegionHtml(region) {
  const clone = region.cloneNode(true);
  clone.querySelectorAll(
    ".ssenc-relock, .ssenc-remove").forEach(
    function (el) { el.remove(); });
  return clone.innerHTML;
}

/* Keep one region's stored ciphertext current with
   its content. Runs as a per region chain: each new
   snapshot is encrypted in order, and the region's
   data attributes land when its encryption does, so
   the attributes always name a ciphertext OF the
   region (the newest landed one). */
function ssencScheduleRegionEncrypt(region) {
  const rid = region.getAttribute("data-ssenc-rid");
  const rec = ssencRegions.get(rid);
  if (!rec || !ssencKey) { return; }
  rec.queuedHtml = ssencRegionHtml(region);
  if (rec.running) { return; }
  rec.running = true;
  rec.chain = (async function () {
    try {
      while (rec.queuedHtml !== null && ssencKey) {
        const snap = rec.queuedHtml;
        rec.queuedHtml = null;
        const out = await ssencEncryptHtml(snap);
        if (!region.isConnected) { break; }
        region.setAttribute("data-ssenc-iv", out.iv);
        region.setAttribute("data-ssenc-ct", out.ct);
        const now = ssencRegionHtml(region);
        if (now !== snap && rec.queuedHtml === null) {
          rec.queuedHtml = now;
        }
      }
    } catch (err) {
      /* A failed re-encryption keeps the previous
         ciphertext standing; the flush below retries
         before any save collects. */
      console.warn("Passage re-encryption failed:", err);
    }
    rec.running = false;
  })();
}

/* Await every region chain in the open note, then
   re-encrypt any region whose content moved past its
   landed ciphertext, until the open note's regions
   are all current. Called before the autosave
   collects, and before the vault locks. */
async function ssencFlushEditorRegions() {
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl || !ssencKey) { return; }
  for (let pass = 0; pass < 4; pass++) {
    const regions = Array.from(
      bodyEl.querySelectorAll(".ssenc-open"));
    regions.forEach(ssencScheduleRegionEncrypt);
    await Promise.all(regions.map(function (region) {
      const rec = ssencRegions.get(
        region.getAttribute("data-ssenc-rid"));
      return rec ? rec.chain : null;
    }));
    const stale = regions.some(function (region) {
      const rec = ssencRegions.get(
        region.getAttribute("data-ssenc-rid"));
      return rec && rec.queuedHtml !== null;
    });
    if (!stale) { return; }
  }
}

/* The body HTML a save may serialize: the editor's
   body with every decrypted region replaced by its
   locked block, built from the region's own current
   ciphertext attributes. Decrypted HTML itself never
   leaves through here, at any timing. */
function ssencSerializedBodyHtml() {
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl) { return ""; }
  if (!bodyEl.querySelector(".ssenc-open")) {
    return bodyEl.innerHTML;
  }
  const clone = bodyEl.cloneNode(true);
  clone.querySelectorAll(".ssenc-open").forEach(
    function (region) {
      const block = ssencBuildBlock(
        region.getAttribute("data-ssenc-iv") || "",
        region.getAttribute("data-ssenc-ct") || "");
      region.parentNode.replaceChild(block, region);
    });
  return clone.innerHTML;
}

/* Decrypt every locked block in the open note, in
   place. A block whose ciphertext does not
   authenticate keeps its place and its payload and
   gains an error face; the rest of the note is
   untouched and nothing throws. */
async function ssencDecryptOpenNoteBlocks() {
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl || !ssencKey) { return; }
  const blocks = Array.from(
    bodyEl.querySelectorAll("[data-ssenc]"));
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block.isConnected) { continue; }
    try {
      const html = await ssencDecryptHtml(
        block.getAttribute("data-ssenc-iv"),
        block.getAttribute("data-ssenc-ct"));
      const region = ssencBuildRegion(html,
        block.getAttribute("data-ssenc-iv"),
        block.getAttribute("data-ssenc-ct"));
      block.parentNode.replaceChild(region, block);
      /* v2.91.0: the restored fragment is rebound
         through the note load render pass, so the
         links, pills, and cards inside it are live
         again (see ssencRebindFragment). */
      ssencRebindFragment(region);
    } catch (err) {
      block.classList.add("ssenc-error");
      const face = block.querySelector(".ssenc-face-text");
      if (face) {
        face.textContent =
          "Encrypted text (cannot be decrypted)";
      }
    }
  }
}

/* Replace the open note's decrypted regions with
   their locked blocks, from the regions' own current
   ciphertext. The first half of locking, in order:
   this runs before the key is ever cleared. */
function ssencRelockOpenNoteRegions() {
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl) { return; }
  Array.from(bodyEl.querySelectorAll(".ssenc-open"))
    .forEach(function (region) {
      const block = ssencBuildBlock(
        region.getAttribute("data-ssenc-iv") || "",
        region.getAttribute("data-ssenc-ct") || "");
      region.parentNode.replaceChild(block, region);
    });
}

/* renderEditor's fill calls this once the body stands:
   while unlocked, the note's passages open in place;
   while locked, the stored blocks already show their
   faces and nothing runs. */
function ssencDecorateEditorBody() {
  const bodyEl = document.getElementById("noteBody");
  if (bodyEl) {
    /* v2.98.0: the Remove encryption control stands
       ONLY on an open passage (Chris's direction),
       so a locked block's face never carries it.
       Blocks saved by v2.93.0 through v2.97.0 carry
       the control in their stored face markup; it
       is stripped here, on open, so those blocks
       render without it too, and the note's next
       save drops the stale markup from the file.
       (Through v2.97.0 this decoration ran the
       other way, adding the control to older
       faces.) Decoration only: nothing here marks
       the note. */
    bodyEl.querySelectorAll("[data-ssenc]").forEach(
      function (block) {
        block.querySelectorAll(".ssenc-remove")
          .forEach(function (ctl) { ctl.remove(); });
        /* A strip target mark can ride into the
           file on a block an undo restored after
           its strip (see ssencStripInsert); it is
           runtime scaffolding, scrubbed here like
           the stale control. */
        block.removeAttribute(
          "data-ssenc-strip-target");
      });
  }
  if (ssencKey) { void ssencDecryptOpenNoteBlocks(); }
}

/* Drop the chain records of regions no longer in the
   document (a note switch replaced the body wholesale;
   the outgoing note was settled and flushed first). */
function ssencPruneRegions() {
  ssencRegions.forEach(function (rec, rid) {
    if (!rec.el.isConnected) { ssencRegions.delete(rid); }
  });
}

function ssencClearUnlockTimer() {
  if (ssencUnlockTimer !== null) {
    clearTimeout(ssencUnlockTimer);
    ssencUnlockTimer = null;
  }
}

/* The duration runs from the unlock moment, as Chris
   scoped it; the "close" choice arms no timer. */
function ssencArmUnlockTimer() {
  ssencClearUnlockTimer();
  const choice = state.ssencUnlockChoice;
  if (typeof choice === "number" && Number.isFinite(choice)) {
    ssencUnlockTimer = setTimeout(function () {
      void ssencLockVault();
    }, choice * 60000);
  }
}

/* Lock the vault: flush and re-encrypt the open note
   first, then clear the key, in that order. Safe to
   call while already locked. */
async function ssencLockVault() {
  ssencClearUnlockTimer();
  if (!ssencKey) { renderSsencSettingsRow(); return; }
  await ssencFlushEditorRegions();
  ssencRelockOpenNoteRegions();
  ssencKey = null;
  ssencPruneRegions();
  renderSsencSettingsRow();
}

/* Try a passphrase against the standing record. On
   success the vault is unlocked (timer armed, the
   open note's passages decrypted, the Settings row
   refreshed); on failure nothing at all changes. */
async function ssencTryUnlock(passphrase) {
  const record = sanitizeEncryptionRecord(state.encryption);
  if (!record) { return false; }
  try {
    const kek = await ssencDeriveKek(passphrase, record);
    const raw = await crypto.subtle.decrypt(
      { name: "AES-GCM",
        iv: ssencB64UrlToBytes(record.wrappedKey.iv) },
      kek, ssencB64UrlToBytes(record.wrappedKey.data));
    ssencKey = await ssencImportVaultKey(new Uint8Array(raw));
  } catch (err) {
    return false;
  }
  ssencArmUnlockTimer();
  await ssencDecryptOpenNoteBlocks();
  renderSsencSettingsRow();
  return true;
}

/* Create the record from a fresh passphrase and stand
   unlocked under it. The record saves through the
   index path like every other index fact. */
async function ssencCreateRecord(passphrase) {
  const salt = ssencRandomBytes(16);
  const partial = {
    version: 1,
    kdfSalt: ssencBytesToB64Url(salt),
    kdfIterations: SSENC_KDF_ITERATIONS,
    wrappedKey: { iv: "", data: "" }
  };
  const kek = await ssencDeriveKek(passphrase, partial);
  const vaultRaw = ssencRandomBytes(32);
  const iv = ssencRandomBytes(12);
  const wrapped = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv }, kek, vaultRaw);
  const record = {
    version: 1,
    kdfSalt: partial.kdfSalt,
    kdfIterations: SSENC_KDF_ITERATIONS,
    wrappedKey: {
      iv: ssencBytesToB64Url(iv),
      data: ssencBytesToB64Url(new Uint8Array(wrapped))
    }
  };
  state.encryption = record;
  saveIndex();
  ssencKey = await ssencImportVaultKey(vaultRaw);
  ssencArmUnlockTimer();
  renderSsencSettingsRow();
  return true;
}

/* ---------- v2.94.0: the recovery key ----------
   A second wrapper on the same vault key, under a
   key derived from a code the user saves. The code
   is 32 characters of an unambiguous base32
   alphabet (Crockford's: no I, L, O, or U, so
   nothing in it looks like anything else), 8 groups
   of 4, 160 bits from the platform random source.
   The record's optional recovery field holds only
   a salt and the wrapped vault key; the code's
   plaintext is stored nowhere, in no payload, and
   exists only in page memory and in the one dialog
   that shows it once. */

const SSENC_RECOVERY_ALPHABET =
  "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function ssencHasRecovery() {
  const record = sanitizeEncryptionRecord(state.encryption);
  return !!(record && record.recovery);
}

/* 20 random bytes to 32 base32 characters, bit
   stream packed big endian: exactly 160 bits, no
   padding characters to explain. */
function ssencRecoveryCodeFromBytes(bytes) {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < bytes.length; i++) {
    buffer = (buffer << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += SSENC_RECOVERY_ALPHABET[(buffer >>> bits) & 31];
    }
  }
  return out;
}

function ssencRecoveryDisplay(code) {
  return code.replace(/(.{4})/g, "$1-").replace(/-$/, "");
}

/* What the user typed, made canonical: case does
   not matter, dashes and spaces (any punctuation)
   are ignored, and the Crockford confusables are
   read as the digits they were probably meant to
   be (O as 0, I and L as 1). Anything that is not
   32 alphabet characters after that is not a key. */
function ssencNormalizeRecoveryCode(text) {
  let out = String(text || "").toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
  out = out.replace(/O/g, "0").replace(/[IL]/g, "1");
  if (out.length !== 32) { return null; }
  for (let i = 0; i < out.length; i++) {
    if (SSENC_RECOVERY_ALPHABET.indexOf(out[i]) < 0) {
      return null;
    }
  }
  return out;
}

/* Mint (or replace) the recovery wrapper on the
   standing record. The vault key must be held; the
   caller arranges that. Resolves the display code,
   or null when there is nothing to wrap or no key.
   The record saves through the index path like
   every other index fact. */
async function ssencMintRecoveryKey() {
  const record = sanitizeEncryptionRecord(state.encryption);
  if (!record || !ssencKey) { return null; }
  const raw = new Uint8Array(
    await crypto.subtle.exportKey("raw", ssencKey));
  try {
    const code = ssencRecoveryCodeFromBytes(
      ssencRandomBytes(20));
    const saltB64 = ssencBytesToB64Url(
      ssencRandomBytes(16));
    const kek = await ssencDeriveKek(code,
      { kdfSalt: saltB64,
        kdfIterations: SSENC_KDF_ITERATIONS });
    const iv = ssencRandomBytes(12);
    const wrapped = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv }, kek, raw);
    record.recovery = {
      kdfSalt: saltB64,
      kdfIterations: SSENC_KDF_ITERATIONS,
      wrappedKey: {
        iv: ssencBytesToB64Url(iv),
        data: ssencBytesToB64Url(
          new Uint8Array(wrapped))
      }
    };
    state.encryption = record;
    saveIndex();
    renderSsencSettingsRow();
    return ssencRecoveryDisplay(code);
  } finally {
    raw.fill(0);
  }
}

/* ---------- the show-it-once dialog ---------- */

let ssencRecoveryShowResolve = null;

/* Show a minted code exactly once. The dialog's
   only door out is the acknowledgement button:
   there is no cancel, and the app's modal family
   gives it no backdrop or Escape close either. The
   code leaves the field as the dialog closes. */
function ssencShowRecoveryKeyDialog(code) {
  return new Promise(function (resolve) {
    ssencRecoveryShowResolve = resolve;
    const input = document.getElementById(
      "ssencRecoveryCodeText");
    if (input) { input.value = code; }
    const modal = document.getElementById(
      "ssencRecoveryShowModal");
    if (modal) { modal.classList.remove("hidden"); }
    const ack = document.getElementById(
      "ssencRecoveryAckBtn");
    if (ack) { ack.focus(); }
  });
}

function ssencCloseRecoveryShowDialog() {
  const modal = document.getElementById(
    "ssencRecoveryShowModal");
  if (modal) { modal.classList.add("hidden"); }
  const input = document.getElementById(
    "ssencRecoveryCodeText");
  if (input) { input.value = ""; }
  const resolve = ssencRecoveryShowResolve;
  ssencRecoveryShowResolve = null;
  if (resolve) { resolve(true); }
}

function ssencCopyRecoveryCode() {
  const input = document.getElementById(
    "ssencRecoveryCodeText");
  const code = input ? input.value : "";
  if (!code) { return; }
  if (navigator.clipboard &&
      navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(
      function () { toast("Recovery key copied."); },
      function () {
        if (input) { input.focus(); input.select(); }
        toast("Copy did not work. Select the key " +
          "and copy it by hand.", true);
      });
  } else if (input) {
    input.focus();
    input.select();
  }
}

/* The Settings recovery row's door (Set up, or
   Regenerate once one stands): the vault key must
   be held first, through the ordinary unlock when
   the vault is locked; then the new code is minted
   (replacing any standing wrapper, which kills the
   old code from that moment) and shown once. */
async function ssencRecoverySettingsFlow() {
  if (!ssencHasRecord()) { return; }
  if (!ssencKey) {
    const unlocked = await ssencOpenUnlockDialog();
    if (!unlocked) { return; }
  }
  let code = null;
  try {
    code = await ssencMintRecoveryKey();
  } catch (err) {
    code = null;
  }
  if (!code) {
    toast("The recovery key could not be created " +
      "on this device.", true);
    return;
  }
  await ssencShowRecoveryKeyDialog(code);
  toast("Your recovery key is set up.");
}

/* ---------- the recover dialog ---------- */

/* The vault key's raw bytes between the code's
   proof and the new passphrase, or null. Page
   memory only, zeroed on every exit. */
let ssencRecoverRaw = null;
let ssencRecoverStep = 1;

function ssencShowRecoverError(message) {
  const wrap = document.getElementById(
    "ssencRecoverError");
  const text = document.getElementById(
    "ssencRecoverErrorText");
  if (text) { text.textContent = message || ""; }
  if (wrap) {
    wrap.classList.toggle("hidden", !message);
  }
}

function ssencOpenRecoverDialog() {
  ssencRecoverStep = 1;
  if (ssencRecoverRaw) {
    ssencRecoverRaw.fill(0);
    ssencRecoverRaw = null;
  }
  const code = document.getElementById(
    "ssencRecoverCode");
  const p1 = document.getElementById(
    "ssencRecoverPass1");
  const p2 = document.getElementById(
    "ssencRecoverPass2");
  if (code) { code.value = ""; }
  if (p1) { p1.value = ""; }
  if (p2) { p2.value = ""; }
  document.getElementById("ssencRecoverCodeField")
    .classList.remove("hidden");
  document.getElementById("ssencRecoverNewFields")
    .classList.add("hidden");
  document.getElementById("ssencRecoverBtn")
    .textContent = "Use recovery key";
  ssencShowRecoverError("");
  document.getElementById("ssencUnlockModal")
    .classList.add("hidden");
  document.getElementById("ssencRecoverModal")
    .classList.remove("hidden");
  if (code) { code.focus(); }
}

/* Back returns to the unlock dialog, whose promise
   is still standing; nothing has been decided. */
function ssencCloseRecoverDialog() {
  if (ssencRecoverRaw) {
    ssencRecoverRaw.fill(0);
    ssencRecoverRaw = null;
  }
  ssencRecoverStep = 1;
  document.getElementById("ssencRecoverModal")
    .classList.add("hidden");
  document.getElementById("ssencUnlockModal")
    .classList.remove("hidden");
  const input = document.getElementById(
    "ssencUnlockPass");
  if (input) { input.focus(); }
}

/* The recover form's one submit path, two steps.
   Step 1 proves the code by unwrapping the vault
   key with it (a wrong code fails the unwrap and
   changes nothing, the passphrase refusal's exact
   standing). Step 2 sets the new passphrase the
   design requires: the vault key is rewrapped
   under it with a fresh salt, the old passphrase
   stops working, and the recovery wrapper is
   carried across untouched, so the same code
   still works afterward. Only then does the
   unlock complete, through the unlock dialog's
   standing promise, so whatever flow asked for
   the unlock (the editor, Settings, or the Remove
   encryption flow) opens as it would have. */
async function ssencRecoverConfirm() {
  const record = sanitizeEncryptionRecord(
    state.encryption);
  if (!record || !record.recovery) {
    ssencCloseRecoverDialog();
    return;
  }
  if (ssencRecoverStep === 1) {
    const input = document.getElementById(
      "ssencRecoverCode");
    const code = ssencNormalizeRecoveryCode(
      input ? input.value : "");
    if (!code) {
      ssencShowRecoverError("Enter the recovery " +
        "key, all 32 characters of it.");
      return;
    }
    let raw = null;
    try {
      const kek = await ssencDeriveKek(code,
        record.recovery);
      raw = new Uint8Array(await crypto.subtle
        .decrypt(
          { name: "AES-GCM",
            iv: ssencB64UrlToBytes(
              record.recovery.wrappedKey.iv) },
          kek,
          ssencB64UrlToBytes(
            record.recovery.wrappedKey.data)));
    } catch (err) {
      raw = null;
    }
    if (!raw) {
      ssencShowRecoverError("That recovery key " +
        "does not match the one that locked " +
        "this text.");
      return;
    }
    ssencRecoverRaw = raw;
    ssencRecoverStep = 2;
    if (input) { input.value = ""; }
    document.getElementById("ssencRecoverCodeField")
      .classList.add("hidden");
    document.getElementById("ssencRecoverNewFields")
      .classList.remove("hidden");
    document.getElementById("ssencRecoverBtn")
      .textContent = "Set new passphrase";
    ssencShowRecoverError("");
    const p1 = document.getElementById(
      "ssencRecoverPass1");
    if (p1) { p1.focus(); }
    return;
  }
  const p1 = document.getElementById(
    "ssencRecoverPass1");
  const p2 = document.getElementById(
    "ssencRecoverPass2");
  const a = p1 ? p1.value : "";
  const b = p2 ? p2.value : "";
  if (!a) {
    ssencShowRecoverError("Enter a new passphrase.");
    return;
  }
  if (a !== b) {
    ssencShowRecoverError("The two passphrases " +
      "do not match.");
    return;
  }
  if (!ssencRecoverRaw) {
    ssencCloseRecoverDialog();
    return;
  }
  try {
    const saltB64 = ssencBytesToB64Url(
      ssencRandomBytes(16));
    const kek = await ssencDeriveKek(a,
      { kdfSalt: saltB64,
        kdfIterations: SSENC_KDF_ITERATIONS });
    const iv = ssencRandomBytes(12);
    const wrapped = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv }, kek,
      ssencRecoverRaw);
    state.encryption = {
      version: 1,
      kdfSalt: saltB64,
      kdfIterations: SSENC_KDF_ITERATIONS,
      wrappedKey: {
        iv: ssencBytesToB64Url(iv),
        data: ssencBytesToB64Url(
          new Uint8Array(wrapped))
      },
      recovery: record.recovery
    };
    saveIndex();
    ssencKey = await ssencImportVaultKey(
      ssencRecoverRaw);
  } catch (err) {
    ssencShowRecoverError("Recovery could not be " +
      "completed on this device.");
    return;
  }
  ssencRecoverRaw.fill(0);
  ssencRecoverRaw = null;
  ssencRecoverStep = 1;
  document.getElementById("ssencRecoverModal")
    .classList.add("hidden");
  ssencArmUnlockTimer();
  await ssencDecryptOpenNoteBlocks();
  renderSsencSettingsRow();
  ssencCloseDialog("unlock", true);
}

/* ---------- v2.94.0 amendment: change passphrase --
   The Settings home's own management path (Chris:
   the passphrase serves the whole app, so it is
   managed in Settings). The current passphrase
   proves itself by unwrapping the vault key; the
   new one rewraps that same key under a fresh
   salt. The encrypted text is never touched, and
   the recovery wrapper, which wraps the same
   vault key, is carried across unchanged and
   stays valid. Whether the vault stands locked or
   unlocked makes no difference to the record; an
   unlocked vault simply keeps its key. */

function ssencShowChangeError(message) {
  const wrap = document.getElementById(
    "ssencChangeError");
  const text = document.getElementById(
    "ssencChangeErrorText");
  if (text) { text.textContent = message || ""; }
  if (wrap) {
    wrap.classList.toggle("hidden", !message);
  }
}

function ssencOpenChangeDialog() {
  if (!ssencHasRecord()) { return; }
  const p0 = document.getElementById(
    "ssencChangePass0");
  const p1 = document.getElementById(
    "ssencChangePass1");
  const p2 = document.getElementById(
    "ssencChangePass2");
  if (p0) { p0.value = ""; }
  if (p1) { p1.value = ""; }
  if (p2) { p2.value = ""; }
  ssencShowChangeError("");
  document.getElementById("ssencChangeModal")
    .classList.remove("hidden");
  if (p0) { p0.focus(); }
}

function ssencCloseChangeDialog() {
  document.getElementById("ssencChangeModal")
    .classList.add("hidden");
  const p0 = document.getElementById(
    "ssencChangePass0");
  const p1 = document.getElementById(
    "ssencChangePass1");
  const p2 = document.getElementById(
    "ssencChangePass2");
  if (p0) { p0.value = ""; }
  if (p1) { p1.value = ""; }
  if (p2) { p2.value = ""; }
}

async function ssencChangeConfirm() {
  const record = sanitizeEncryptionRecord(
    state.encryption);
  if (!record) {
    ssencCloseChangeDialog();
    return;
  }
  const p0 = document.getElementById(
    "ssencChangePass0");
  const p1 = document.getElementById(
    "ssencChangePass1");
  const p2 = document.getElementById(
    "ssencChangePass2");
  const cur = p0 ? p0.value : "";
  const a = p1 ? p1.value : "";
  const b = p2 ? p2.value : "";
  if (!cur) {
    ssencShowChangeError("Enter your current " +
      "passphrase.");
    return;
  }
  if (!a) {
    ssencShowChangeError("Enter a new passphrase.");
    return;
  }
  if (a !== b) {
    ssencShowChangeError("The two new passphrases " +
      "do not match.");
    return;
  }
  let raw = null;
  try {
    const kek = await ssencDeriveKek(cur, record);
    raw = new Uint8Array(await crypto.subtle
      .decrypt(
        { name: "AES-GCM",
          iv: ssencB64UrlToBytes(
            record.wrappedKey.iv) },
        kek,
        ssencB64UrlToBytes(record.wrappedKey.data)));
  } catch (err) {
    raw = null;
  }
  if (!raw) {
    ssencShowChangeError("That current passphrase " +
      "does not match the one that locked " +
      "this text.");
    return;
  }
  try {
    const saltB64 = ssencBytesToB64Url(
      ssencRandomBytes(16));
    const kek = await ssencDeriveKek(a,
      { kdfSalt: saltB64,
        kdfIterations: SSENC_KDF_ITERATIONS });
    const iv = ssencRandomBytes(12);
    const wrapped = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv }, kek, raw);
    const next = {
      version: 1,
      kdfSalt: saltB64,
      kdfIterations: SSENC_KDF_ITERATIONS,
      wrappedKey: {
        iv: ssencBytesToB64Url(iv),
        data: ssencBytesToB64Url(
          new Uint8Array(wrapped))
      }
    };
    if (record.recovery) {
      next.recovery = record.recovery;
    }
    state.encryption = next;
    saveIndex();
  } catch (err) {
    raw.fill(0);
    ssencShowChangeError("The passphrase could " +
      "not be changed on this device.");
    return;
  }
  raw.fill(0);
  ssencCloseChangeDialog();
  renderSsencSettingsRow();
  toast("Your passphrase is changed.");
}

/* ---------- the setup and unlock dialogs ---------- */

function ssencShowDialogError(kind, message) {
  const wrap = document.getElementById(
    kind === "setup" ? "ssencSetupError" : "ssencUnlockError");
  const text = document.getElementById(
    kind === "setup" ? "ssencSetupErrorText"
      : "ssencUnlockErrorText");
  if (text) { text.textContent = message || ""; }
  if (wrap) {
    wrap.classList.toggle("hidden", !message);
  }
}

function ssencCloseDialog(kind, value) {
  const modal = document.getElementById(
    kind === "setup" ? "ssencSetupModal" : "ssencUnlockModal");
  if (modal) { modal.classList.add("hidden"); }
  const pending = ssencDialogPending;
  ssencDialogPending = null;
  if (pending && pending.kind === kind) {
    pending.resolve(value);
  }
}

/* Both dialogs resolve a promise: true when the vault
   stands unlocked because of them, false on cancel. */
function ssencOpenSetupDialog() {
  return new Promise(function (resolve) {
    ssencDialogPending = { kind: "setup", resolve: resolve };
    const p1 = document.getElementById("ssencSetupPass1");
    const p2 = document.getElementById("ssencSetupPass2");
    if (p1) { p1.value = ""; }
    if (p2) { p2.value = ""; }
    ssencShowDialogError("setup", "");
    const modal = document.getElementById("ssencSetupModal");
    if (modal) { modal.classList.remove("hidden"); }
    if (p1) { p1.focus(); }
  });
}

function ssencOpenUnlockDialog() {
  return new Promise(function (resolve) {
    ssencDialogPending = { kind: "unlock", resolve: resolve };
    const input = document.getElementById("ssencUnlockPass");
    if (input) { input.value = ""; }
    ssencShowDialogError("unlock", "");
    /* v2.94.0: the Use recovery key door stands
       only when the record holds a recovery
       wrapper; a record without one shows the
       dialog exactly as v2.93.0 left it. */
    const recBtn = document.getElementById(
      "ssencUnlockRecoveryBtn");
    if (recBtn) {
      recBtn.classList.toggle("hidden",
        !ssencHasRecovery());
    }
    const modal = document.getElementById("ssencUnlockModal");
    if (modal) { modal.classList.remove("hidden"); }
    if (input) { input.focus(); }
  });
}

async function ssencSetupConfirm() {
  const p1 = document.getElementById("ssencSetupPass1");
  const p2 = document.getElementById("ssencSetupPass2");
  const a = p1 ? p1.value : "";
  const b = p2 ? p2.value : "";
  if (!a) {
    ssencShowDialogError("setup", "Enter a passphrase.");
    return;
  }
  if (a !== b) {
    ssencShowDialogError("setup",
      "The two passphrases do not match.");
    return;
  }
  try {
    await ssencCreateRecord(a);
  } catch (err) {
    ssencShowDialogError("setup",
      "Encryption could not be set up on this device.");
    return;
  }
  /* v2.94.0: a new vault starts with recovery in
     place. The key is minted under the just created
     vault and shown once, and setup completes only
     when the user has saved it. If the mint itself
     fails on this device, setup still completes:
     the Settings row offers the mint again. */
  try {
    const code = await ssencMintRecoveryKey();
    if (code) {
      await ssencShowRecoveryKeyDialog(code);
    }
  } catch (err) { /* Set up later, from Settings. */ }
  ssencCloseDialog("setup", true);
}

async function ssencUnlockConfirm() {
  const input = document.getElementById("ssencUnlockPass");
  const pass = input ? input.value : "";
  if (!pass) {
    ssencShowDialogError("unlock", "Enter your passphrase.");
    return;
  }
  const ok = await ssencTryUnlock(pass);
  if (!ok) {
    ssencShowDialogError("unlock",
      "That passphrase does not match the one that " +
      "locked this text.");
    return;
  }
  ssencCloseDialog("unlock", true);
}

/* The Settings row's Unlock and Set up doors: setup
   when no record stands, unlock when one does. */
async function ssencUnlockFlow() {
  if (!ssencHasRecord()) {
    await ssencOpenSetupDialog();
    return;
  }
  if (!ssencKey) { await ssencOpenUnlockDialog(); }
}

/* ---------- the Encrypt action ---------- */

/* Judge the live selection for the Encrypt action.
   Returns {ok, range, html} or {ok:false, message}
   under the refusal rule in this section's header:
   v2.91.0 takes the selection's exact HTML fragment
   with no structural restriction, so selections
   spanning several paragraphs, headings, blockquotes,
   partial list items (starting mid item and ending
   mid item elsewhere), checklist items, mixed inline
   formatting and links, and selections containing
   attachment cards, images, or tables are all
   encryptable.

   v2.93.0 (Chris's direction) adds the one refusal
   that widening had left open: a selection touching
   already encrypted text is refused outright. Any
   intersection with a locked block or an open
   decrypted region, the passage wholly covered, the
   passage clipped at an edge, or the selection
   standing wholly inside a region, refuses the
   whole selection with a toast, and nothing changes:
   no nesting, no subsuming, and no partial
   encryption of the selection's plain remainder
   (the v2.91.0 carrying behavior is removed, so
   text that is already encrypted cannot be
   encrypted again). A selection that merely sits
   next to a passage without touching it still
   encrypts. The fragment then passes through the
   same canonicalization every save applies, so
   attachment shells, link faces, fold chrome, and
   the note tasks marker reach the payload in
   exactly their saved shapes. */
function ssencSelectionPlan() {
  const bodyEl = document.getElementById("noteBody");
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) {
    return { ok: false, message: "Select the text to encrypt first." };
  }
  const range = sel.getRangeAt(0);
  if (range.collapsed ||
      !bodyEl.contains(range.commonAncestorContainer)) {
    return { ok: false, message: "Select the text to encrypt first." };
  }
  const guarded = bodyEl.querySelectorAll(
    "[data-ssenc], .ssenc-open");
  for (let i = 0; i < guarded.length; i++) {
    if (range.intersectsNode(guarded[i])) {
      return { ok: false, message: "That selection " +
        "includes text that is already encrypted, " +
        "and encrypted text cannot be encrypted " +
        "again." };
    }
  }
  const holder = document.createElement("div");
  holder.appendChild(range.cloneContents());
  return { ok: true, range: range.cloneRange(),
    html: canonicalizeAttachmentPlaceholders(
      holder.innerHTML) };
}

/* The Encrypt action itself (the toolbar More menu's
   Encrypt selected text item): judge the selection,
   walk the setup or unlock dialog when the vault
   cannot encrypt yet, then replace the selection with
   its locked block. Cancelling a dialog changes
   nothing at all. */
async function ssencEncryptSelectionFlow() {
  const plan = ssencSelectionPlan();
  if (!plan.ok) { toast(plan.message, true); return; }
  if (!ssencHasRecord()) {
    const setUp = await ssencOpenSetupDialog();
    if (!setUp) { return; }
  } else if (!ssencKey) {
    const unlocked = await ssencOpenUnlockDialog();
    if (!unlocked) { return; }
  }
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl.contains(plan.range.commonAncestorContainer)) {
    toast("That selection is gone. Select the text " +
      "again and try again.", true);
    return;
  }
  const out = await ssencEncryptHtml(plan.html);
  plan.range.deleteContents();
  const block = ssencBuildBlock(out.iv, out.ct);
  plan.range.insertNode(block);
  /* v2.91.0: the replacement could once cut an open
     region the selection crossed; since v2.93.0 such
     a selection is refused before this point, so no
     region can be crossed here. Any region left
     standing beside the insert is still told to
     re-encrypt from its current content (the insert
     fired no input event, so its chain could be
     stale), and records for regions no longer in the
     body are pruned before they can chain. */
  bodyEl.querySelectorAll(".ssenc-open").forEach(
    function (region) {
      ssencScheduleRegionEncrypt(region);
    });
  ssencPruneRegions();
  const sel = window.getSelection();
  const after = document.createRange();
  after.setStartAfter(block);
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);
  markDirty();
}

/* ---------- removing one passage's encryption ---------- */

/* v2.98.0: the removal has exactly one door, the
   open region's own control (ssencRemoveOpenRegionFlow
   below). The locked block's face control and its
   flow (which unlocked first when the vault was
   locked, or decrypted the pointed block directly
   when it stood unlocked, bridging block to region
   by ciphertext) are gone on Chris's direction
   that the control stand ONLY on an open passage:
   a locked passage is opened first, like any other
   reading of it, and removed from there. */

/* Whether an element is one of the empty shells the
   encrypt flow leaves behind when a multi-paragraph
   selection is encrypted (the emptied source
   paragraphs beside the new block), or an equally
   content-free paragraph: no element children other
   than line breaks, and no text beyond whitespace
   and the invisible characters an editor parks in
   an empty paragraph. Only ever consulted for an
   element standing immediately beside a passage
   being stripped, so a reader's own blank line
   elsewhere in a note is never touched. */
function ssencIsShellEl(node) {
  if (!node || node.nodeType !== 1) { return false; }
  if (!/^(P|DIV)$/.test(node.tagName)) { return false; }
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (child.nodeType === 1) {
      if (child.tagName !== "BR") { return false; }
    } else if (child.nodeType === 3) {
      if (child.nodeValue.replace(/[\s\u200B\uFEFF]/g,
        "") !== "") {
        return false;
      }
    } else {
      return false;
    }
  }
  return true;
}

/* The v2.94.0 strip's one native insert, as
   ssencStripRegion's comment describes: replace the
   locked block's block-level container through a
   single insertHTML built on a clone, trailed by
   one guard paragraph. Returns true when the insert
   ran. The guard is found again afterward by its
   mark: a guard still empty is removed (it was
   scaffolding), and a guard that absorbed the
   following content keeps that content and loses
   only the mark. */
function ssencStripInsert(bodyEl, block, plainHtml) {
  /* The unit: the block's nearest block-level
     ancestor inside the body, or a fresh paragraph
     wrapper when the block stands in the body
     itself (the block-form shape). */
  let unit = block;
  let wrapped = false;
  if (block.parentNode !== bodyEl) {
    let n = block.parentNode;
    while (n && n !== bodyEl &&
      !/^(P|LI|BLOCKQUOTE|TD|TH|H[1-6]|DIV)$/
        .test(n.tagName)) {
      n = n.parentNode;
    }
    if (n && n !== bodyEl) { unit = n; }
  } else {
    const wrap = document.createElement("p");
    block.parentNode.insertBefore(wrap, block);
    wrap.appendChild(block);
    unit = wrap;
    wrapped = true;
  }
  /* The encrypt flow's own shells beside the unit
     go away before the insert, outside the undo
     step, like the region swap that produced the
     block. */
  const host = unit.parentNode;
  if (!host) { return false; }
  while (ssencIsShellEl(unit.previousSibling)) {
    host.removeChild(unit.previousSibling);
  }
  while (ssencIsShellEl(unit.nextSibling)) {
    host.removeChild(unit.nextSibling);
  }
  /* A following sibling that is not a paragraph
     joins the selection by clone: at a bare list,
     table, or block boundary the insertion instead
     pulls the content into the container or leaves
     a ghost behind it. A paragraph sibling stays
     out; the guard below absorbs its boundary. */
  const sib = unit.nextElementSibling;
  const sibIn = !!sib && sib.parentNode === host &&
    !/^(P|H[1-6]|BLOCKQUOTE)$/.test(sib.tagName);
  const lastUnit = sibIn ? sib : unit;
  /* The replacement, built on clones so the live
     tree is untouched until the one insert: the
     unit's clone with the block swapped for the
     parsed plain HTML (or, for a wrapped block, the
     plain HTML itself), then the sibling's clone,
     then the guard. */
  /* v2.98.0: the block this strip answers for is
     marked before the clone is taken, and the
     clone surgery finds it by the mark. Through
     v2.97.0 the surgery took the container's FIRST
     [data-ssenc] block, so when another encrypted
     block stood earlier in the same container (a
     paragraph holding two passages, or a locked
     block beside the region being stripped), the
     strip spliced this passage's text in at that
     block's place, deleted that block, and left
     this passage's own block, the "Encrypted
     text" pill, standing untouched (the build
     report carries the captured markup). The mark
     is a token unique to this strip (a standing
     counter), never a bare flag: a mark left from
     an earlier strip can survive on another block
     (an undo restores the block a strip marked,
     the mark on it), and a bare flag would match
     that stale mark first in a later clone and
     splice at the wrong block again, the very
     failure being fixed. The marked clone is the
     element the surgery removes, and where the
     insert refuses and the fallback runs, the
     live block the fallback replaces carries its
     mark out of the tree with it;
     ssencDecorateEditorBody also scrubs the
     attribute from blocks on open, so a mark an
     undo restored never reaches a saved file. */
  /* Marks from earlier strips are cleared first:
     an undo can restore a block an earlier strip
     marked, and its stale mark must never stand
     in this strip's clone. */
  bodyEl.querySelectorAll(
    "[data-ssenc-strip-target]").forEach(
    function (el) {
      el.removeAttribute("data-ssenc-strip-target");
    });
  let stripToken = "";
  if (!wrapped) {
    ssencStripTargetSeq += 1;
    stripToken = String(ssencStripTargetSeq);
    block.setAttribute("data-ssenc-strip-target",
      stripToken);
  }
  const holder = document.createElement("div");
  if (wrapped) {
    holder.innerHTML = plainHtml;
  } else {
    const cUnit = unit.cloneNode(true);
    holder.appendChild(cUnit);
    const cBlock = holder.querySelector(
      "[data-ssenc-strip-target=\"" + stripToken +
      "\"]");
    if (!cBlock) { return false; }
    const fragHolder = document.createElement("div");
    fragHolder.innerHTML = plainHtml;
    const cParent = cBlock.parentNode;
    while (fragHolder.firstChild) {
      cParent.insertBefore(fragHolder.firstChild,
        cBlock);
    }
    cParent.removeChild(cBlock);
  }
  if (sibIn) { holder.appendChild(sib.cloneNode(true)); }
  /* v2.98.0: a paragraph unit with no joined
     sibling is replaced by its CONTENTS, not as
     a node: the range covers the paragraph's
     children and the replacement is the clone's
     inner HTML (the guard still trails it, as a
     sibling after the paragraph). Replacing the
     paragraph as a node made the browser empty
     it and leave the husk standing in front of
     the replacement when the paragraph held a
     non editable block beside the target (the
     block beside region shape); the paragraph
     element, its attributes included, is never
     in the deletion that way, and the insert
     stays the one undo step it has always been.
     Every other shape keeps the whole node
     replacement below. */
  const contentsOnly = !wrapped && !sibIn &&
    unit.tagName === "P";
  const replacement = (contentsOnly ?
      holder.querySelector("p").innerHTML :
      holder.innerHTML) +
    "<p data-ssenc-strip-guard=\"1\"></p>";
  const from = Array.prototype.indexOf.call(
    host.childNodes, unit);
  const to = Array.prototype.indexOf.call(
    host.childNodes, lastUnit);
  if (from < 0 || to < from) { return false; }
  bodyEl.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  if (contentsOnly) {
    range.setStart(unit, 0);
    range.setEnd(unit, unit.childNodes.length);
  } else {
    range.setStart(host, from);
    range.setEnd(host, to + 1);
  }
  sel.removeAllRanges();
  sel.addRange(range);
  const ok = document.execCommand("insertHTML", false,
    replacement) === true;
  if (!ok) { return false; }
  const guardEl = bodyEl.querySelector(
    "[data-ssenc-strip-guard]");
  if (guardEl) {
    if (guardEl.childNodes.length === 0) {
      guardEl.parentNode.removeChild(guardEl);
    } else {
      guardEl.removeAttribute("data-ssenc-strip-guard");
    }
  }
  return true;
}

/* Replace one decrypted region with its own content
   as ordinary note text, for good: the passage's
   encryption is removed, not merely opened.
   v2.94.0 rebuilt the swap's composition after the
   v2.93 form failed in a real browser (see the build
   report's diagnosis): the region first swaps back
   to its locked block, then the block's block-level
   container (its paragraph, list item, or cell; a
   fresh paragraph wrapper when the block stands in
   the body itself) is replaced through a single
   insertHTML whose replacement is built on a clone
   of that container with the passage's plain HTML
   spliced where the block stood, so the content
   lands parented exactly the way ordinary content
   is parented and one Ctrl+Z restores the locked
   block. A container sibling that is not a paragraph
   (a list, a table, another block element) joins the
   selection by clone, because the insertion behaves
   badly at a bare container boundary; a paragraph
   sibling stays out, and one empty guard paragraph
   trails the replacement to absorb the insertion's
   end merge, so the following paragraph is never
   fused into the passage. The empty paragraphs the
   encrypt flow itself leaves beside a block-form
   passage are removed beside the container first
   (outside the undo step, like the region swap
   above). Where insertHTML is unavailable or
   refuses, the block is swapped for the parsed
   content directly (the removal lands; only the
   single undo step is lost). Either way the landed
   content then runs the same fragment rebind pass a
   decrypt restore uses, so the links, pills, and
   cards inside it are live, not inert markup. */
function ssencStripRegion(region) {
  const bodyEl = document.getElementById("noteBody");
  const parent = region.parentNode;
  if (!bodyEl || !parent) { return; }
  const plainHtml = ssencRegionHtml(region);
  const block = ssencBuildBlock(
    region.getAttribute("data-ssenc-iv") || "",
    region.getAttribute("data-ssenc-ct") || "");
  parent.replaceChild(block, region);
  const rid = region.getAttribute("data-ssenc-rid");
  if (rid) { ssencRegions.delete(rid); }
  let done = false;
  if (typeof document.execCommand === "function") {
    try {
      done = ssencStripInsert(bodyEl, block, plainHtml);
    } catch (err) { done = false; }
  }
  if (!done) {
    /* The structural fallback: the parsed content
       takes the block's place in its parent directly.
       The removal lands; only the single undo step
       is lost. The encrypt flow's own shells beside
       the block's container go away first, so the
       fallback leaves the same end state. */
    let anchor = block;
    if (block.parentNode && block.parentNode !== bodyEl) {
      let n = block.parentNode;
      while (n && n !== bodyEl &&
        !/^(P|LI|BLOCKQUOTE|TD|TH|H[1-6]|DIV)$/
          .test(n.tagName)) {
        n = n.parentNode;
      }
      if (n && n !== bodyEl) { anchor = n; }
    }
    if (anchor.parentNode) {
      const host = anchor.parentNode;
      while (ssencIsShellEl(anchor.previousSibling)) {
        host.removeChild(anchor.previousSibling);
      }
      while (ssencIsShellEl(anchor.nextSibling)) {
        host.removeChild(anchor.nextSibling);
      }
    }
    const holder = document.createElement("div");
    holder.innerHTML = plainHtml;
    const frag = document.createDocumentFragment();
    while (holder.firstChild) {
      frag.appendChild(holder.firstChild);
    }
    if (block.parentNode) {
      block.parentNode.replaceChild(frag, block);
    }
  }
  ssencRebindFragment(parent);
}

/* The open region's Remove encryption control
   (v2.97.0, Chris's correction; since v2.98.0 the
   removal's only door, the locked block's face
   control and its flow being removed on his
   direction that the control stand ONLY on an
   open passage): strip this passage's encryption
   permanently, leaving its content standing as
   ordinary note text and every other passage in
   the note untouched. The region's chains are
   flushed first, so the ciphertext its strip
   swap builds the locked block from is the
   passage's current text, edits made while it
   stood open included; the strip itself (see
   ssencStripRegion) then peels the wrapper away
   and leaves the content standing as ordinary
   note text, the region's record dropped, so no
   later collect, lock, or save can re-encrypt
   it. One undo restores the passage as its
   locked block (the strip composes through the
   block); where the strip's fallback ran, the
   removal stands without an undo step. The
   removal marks the note dirty once, so it
   autosaves like any edit. */
async function ssencRemoveOpenRegionFlow(region) {
  const bodyEl = document.getElementById("noteBody");
  if (!region || !bodyEl || !bodyEl.contains(region)) {
    return;
  }
  if (bodyEl.contentEditable === "false") { return; }
  await ssencFlushEditorRegions();
  if (!region.isConnected) { return; }
  ssencStripRegion(region);
  markDirty();
}

/* ---------- Settings ---------- */

/* The Encrypted text row (Settings, Editor tab): the
   standing state in plain words, the unlock duration
   select showing this device's saved choice, a Lock
   button standing while unlocked, and an Unlock or
   Set up button standing otherwise. */
function renderSsencSettingsRow() {
  const status = document.getElementById("settingsSsencStatus");
  const select = document.getElementById(
    "settingsSsencUnlockSelect");
  const lockBtn = document.getElementById("settingsSsencLockBtn");
  const unlockBtn = document.getElementById(
    "settingsSsencUnlockBtn");
  if (select) {
    select.value = String(state.ssencUnlockChoice);
  }
  /* v2.94.0: the Change passphrase button stands
     whenever a vault stands, and the recovery row
     reports and offers the recovery key under the
     same rule (nothing at all before a vault). */
  const changeBtn = document.getElementById(
    "settingsSsencChangeBtn");
  const recStatus = document.getElementById(
    "settingsSsencRecoveryStatus");
  const recBtn = document.getElementById(
    "settingsSsencRecoveryBtn");
  if (changeBtn && recStatus && recBtn) {
    if (!ssencHasRecord()) {
      changeBtn.classList.add("hidden");
      recStatus.textContent = "";
      recBtn.classList.add("hidden");
    } else if (ssencHasRecovery()) {
      changeBtn.classList.remove("hidden");
      recStatus.textContent =
        "Recovery key is set up.";
      recBtn.textContent = "Regenerate recovery key";
      recBtn.classList.remove("hidden");
    } else {
      changeBtn.classList.remove("hidden");
      recStatus.textContent =
        "Recovery key is not set up.";
      recBtn.textContent = "Set up recovery key";
      recBtn.classList.remove("hidden");
    }
  }
  if (!status || !lockBtn || !unlockBtn) { return; }
  if (!ssencHasRecord()) {
    status.textContent = "Not set up";
    unlockBtn.textContent = "Set up passphrase";
    unlockBtn.classList.remove("hidden");
    lockBtn.classList.add("hidden");
  } else if (!ssencKey) {
    status.textContent = "Locked";
    unlockBtn.textContent = "Unlock";
    unlockBtn.classList.remove("hidden");
    lockBtn.classList.add("hidden");
  } else {
    status.textContent = "Unlocked";
    unlockBtn.classList.add("hidden");
    lockBtn.classList.remove("hidden");
  }
}

/* The duration select's change handler: the choice
   persists at once, like every Settings control, on
   this device only. Changing it while unlocked re-arms
   the timer from this moment under the new choice. */
function applySsencUnlockFromSelect() {
  const select = document.getElementById(
    "settingsSsencUnlockSelect");
  if (!select) { return; }
  const raw = select.value;
  const value = raw === "close" ? "close" : Number(raw);
  if (SSENC_UNLOCK_CHOICES.indexOf(value) < 0) { return; }
  state.ssencUnlockChoice = value;
  saveSettings();
  if (ssencKey) { ssencArmUnlockTimer(); }
}

/* This section's wiring, called once from wireEvents:
   the Settings controls, the two dialogs, and the
   editor's delegated region and block handling. */
function wireSsencControls() {
  const select = document.getElementById(
    "settingsSsencUnlockSelect");
  if (select) {
    select.addEventListener("change",
      applySsencUnlockFromSelect);
  }
  const lockBtn = document.getElementById("settingsSsencLockBtn");
  if (lockBtn) {
    lockBtn.addEventListener("click", function () {
      void ssencLockVault();
    });
  }
  const unlockBtn = document.getElementById(
    "settingsSsencUnlockBtn");
  if (unlockBtn) {
    unlockBtn.addEventListener("click", function () {
      void ssencUnlockFlow();
    });
  }
  document.getElementById("ssencSetupCancelBtn")
    .addEventListener("click", function () {
      ssencCloseDialog("setup", false);
    });
  document.getElementById("ssencSetupSaveBtn")
    .addEventListener("click", function () {
      void ssencSetupConfirm();
    });
  document.getElementById("ssencUnlockCancelBtn")
    .addEventListener("click", function () {
      ssencCloseDialog("unlock", false);
    });
  /* v2.93.0: the unlock dialog's confirm runs off
     its form's submit, not the button's click. The
     Unlock button is the form's submit button, so a
     click arrives here as a submission, and pressing
     Enter in the passphrase field arrives here as
     the form's implicit submission: one path, so
     Enter behaves exactly as the button in success
     and in refusal alike. */
  document.getElementById("ssencUnlockForm")
    .addEventListener("submit", function (ev) {
      ev.preventDefault();
      void ssencUnlockConfirm();
    });
  /* v2.94.0: the recovery doors. The Settings row's
     Set up or Regenerate button runs the mint flow;
     the Unlock dialog's Use recovery key button
     swaps the dialog for the recover dialog; the
     recover form's submit is its one confirm path,
     like the unlock form's; the show dialog's two
     buttons copy the code and acknowledge it. */
  const recSettingsBtn = document.getElementById(
    "settingsSsencRecoveryBtn");
  if (recSettingsBtn) {
    recSettingsBtn.addEventListener("click",
      function () {
        void ssencRecoverySettingsFlow();
      });
  }
  document.getElementById("ssencUnlockRecoveryBtn")
    .addEventListener("click", function () {
      ssencOpenRecoverDialog();
    });
  document.getElementById("ssencRecoverCancelBtn")
    .addEventListener("click", function () {
      ssencCloseRecoverDialog();
    });
  document.getElementById("ssencRecoverForm")
    .addEventListener("submit", function (ev) {
      ev.preventDefault();
      void ssencRecoverConfirm();
    });
  document.getElementById("ssencRecoveryAckBtn")
    .addEventListener("click", function () {
      ssencCloseRecoveryShowDialog();
    });
  document.getElementById("ssencRecoveryCopyBtn")
    .addEventListener("click", function () {
      ssencCopyRecoveryCode();
    });
  /* v2.94.0 amendment: Change passphrase, the
     Settings home's management path. */
  const changeSettingsBtn = document.getElementById(
    "settingsSsencChangeBtn");
  if (changeSettingsBtn) {
    changeSettingsBtn.addEventListener("click",
      function () {
        ssencOpenChangeDialog();
      });
  }
  document.getElementById("ssencChangeCancelBtn")
    .addEventListener("click", function () {
      ssencCloseChangeDialog();
    });
  document.getElementById("ssencChangeForm")
    .addEventListener("submit", function (ev) {
      ev.preventDefault();
      void ssencChangeConfirm();
    });
  const bodyEl = document.getElementById("noteBody");
  /* Edits inside a decrypted region keep its stored
     ciphertext current (see the chain above). */
  bodyEl.addEventListener("input", function (ev) {
    const region = ev.target && ev.target.closest
      ? ev.target.closest(".ssenc-open") : null;
    if (region && bodyEl.contains(region)) {
      ssencScheduleRegionEncrypt(region);
    }
  });
  /* A locked block's click is the unlock door; a
     region's lock chip locks the vault. */
  bodyEl.addEventListener("click", function (ev) {
    if (!ev.target || !ev.target.closest) { return; }
    const chip = ev.target.closest(".ssenc-relock");
    if (chip && bodyEl.contains(chip)) {
      ev.preventDefault();
      void ssencLockVault();
      return;
    }
    /* The open region's Remove encryption control
       runs the passage's dissolution; it is judged
       before the block test below, so a press on
       it can never fall through to anything else.
       (v2.93.0 through v2.97.0 a locked block's
       face carried the control too and this branch
       ran that flow for it; since v2.98.0 the
       control stands ONLY on an open passage, so
       a locked block offers no removal to judge:
       clicking one is the unlock door below, like
       any other reading of it.) */
    const removeCtl = ev.target.closest(".ssenc-remove");
    if (removeCtl && bodyEl.contains(removeCtl)) {
      ev.preventDefault();
      const openRegion = removeCtl.closest(".ssenc-open");
      if (openRegion) {
        void ssencRemoveOpenRegionFlow(openRegion);
      }
      return;
    }
    const block = ev.target.closest("[data-ssenc]");
    if (block && bodyEl.contains(block)) {
      if (ssencKey) { void ssencDecryptOpenNoteBlocks(); }
      else { void ssencUnlockFlow(); }
    }
  });
}


/* ==========================================================================
   v2.91.0: the note editor's own right click menu.

   Chris's direction on 2026-11-02 supersedes the
   editor half of the v2.81.0 context menu exception:
   the note body no longer keeps the browser's menu.
   A right click inside the note body editor opens
   this app menu instead (Cut, Copy, Paste, a
   separator, then Encrypt selected text and an
   Unlock or Lock item that follows the vault),
   through the same fixed panel machinery and theming
   as the app's other floating menus. Text fields and
   inputs elsewhere keep the browser menu exactly as
   today: this section listens on the note body
   alone, the document level guard still leaves every
   surface it always left, and the task description
   editor is untouched.

   Per Chris's amendment the same day, the menu has
   NO spell check item: spell checking in the note
   editor is pinned always on. The note body carries
   spellcheck="true" in its markup, the wiring below
   sets it again, and no app path turns it off. (The
   search before this build found no per device or
   default path that could leave the editor's
   spellcheck off: the attribute simply was never
   set, so a browser was free to default it either
   way. It is now pinned in the markup itself.)

   The menu never eats the selection it acts on: its
   mousedown is swallowed so focus and the live
   selection stay in the editor, and every action
   first restores the saved format selection, the
   same pattern the toolbar uses. A right click
   inside an existing selection keeps it (a browser
   does not collapse a selection for a right click
   inside it); a right click elsewhere has already
   placed the caret there before this handler runs,
   as the browser would. The Menu key and Shift+F10
   open the same menu at the caret. The menu closes
   on an outside press and on Escape, and clamps to
   the viewport like the app's other fixed menus.
   ========================================================================== */

function editorCtxMenuEl() {
  return document.getElementById("editorCtxMenu");
}

function closeEditorCtxMenu() {
  const menu = editorCtxMenuEl();
  if (menu) { menu.classList.add("hidden"); }
}

function editorCtxMenuIsOpen() {
  const menu = editorCtxMenuEl();
  return !!menu && !menu.classList.contains("hidden");
}

/* The note body's current selection, for item
   states: a non collapsed range inside the body. */
function editorCtxSelectionInBody() {
  const bodyEl = document.getElementById("noteBody");
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !bodyEl) { return null; }
  const range = sel.getRangeAt(0);
  if (range.collapsed ||
      !bodyEl.contains(range.commonAncestorContainer)) {
    return null;
  }
  return range;
}

/* Fill the item states for the note as it stands,
   then show the menu at (x, y), clamped to the
   viewport like the app's other fixed menus. The
   vault item stands only when the open note contains
   locked blocks or open regions, and its label
   follows the vault: Unlock while locked, Lock
   while unlocked. */
function openEditorCtxMenu(x, y) {
  const bodyEl = document.getElementById("noteBody");
  const menu = editorCtxMenuEl();
  if (!bodyEl || !menu) { return; }
  const hasSel = !!editorCtxSelectionInBody();
  const setDisabled = function (action, disabled) {
    const btn = menu.querySelector(
      "[data-ctx-action=\"" + action + "\"]");
    if (btn) { btn.disabled = disabled; }
  };
  setDisabled("cut", !hasSel);
  setDisabled("copy", !hasSel);
  setDisabled("encrypt", !hasSel);
  const vaultBtn = menu.querySelector(
    "[data-ctx-action=\"vault\"]");
  if (vaultBtn) {
    const hasPassages = !!bodyEl.querySelector(
      "[data-ssenc], .ssenc-open");
    vaultBtn.classList.toggle("hidden", !hasPassages);
    vaultBtn.textContent = ssencKey
      ? "Lock encrypted text" : "Unlock encrypted text";
  }
  /* v2.101.0: the Numbering style item stands only
     while the caret is in a numbered list; its
     submenu starts closed on every open, and the
     item for the level's current style (its chosen
     class, or the depth default) carries the
     current mark. */
  const numBtn = menu.querySelector(
    "[data-ctx-action=\"numstyle\"]");
  const numMenu = menu.querySelector("#editorCtxNumMenu");
  const ctxOl = numberedListAtCaret();
  if (numBtn) {
    numBtn.classList.toggle("hidden", !ctxOl);
  }
  if (numMenu) {
    numMenu.classList.add("hidden");
    if (ctxOl) {
      const current = numberingStyleOf(ctxOl);
      numMenu.querySelectorAll("[data-num-style]")
        .forEach(function (btn) {
          btn.classList.toggle("current",
            btn.getAttribute("data-num-style") === current);
        });
    }
  }
  /* v2.109.0: the Format submenu starts closed on
     every open, and its rows for the formats the
     standing selection currently carries are marked
     current, asked of the document the same moment
     the Numbering marks are read. Clear Formatting
     carries no state and is never marked. */
  const fmtMenu = menu.querySelector(
    "#editorCtxFormatMenu");
  if (fmtMenu) {
    fmtMenu.classList.add("hidden");
    const fmtStates = { bold: "bold",
      italic: "italic", underline: "underline",
      strike: "strikeThrough" };
    fmtMenu.querySelectorAll("[data-format-cmd]")
      .forEach(function (btn) {
        const stateCmd = fmtStates[
          btn.getAttribute("data-format-cmd")];
        let on = false;
        if (stateCmd) {
          try {
            on = !!document.queryCommandState(stateCmd);
          } catch (e) { on = false; }
        }
        btn.classList.toggle("current", on);
      });
  }
  menu.classList.remove("hidden");
  const width = menu.offsetWidth || 200;
  const height = menu.offsetHeight || 170;
  const left = Math.max(8, Math.min(x,
    window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(y,
    window.innerHeight - height - 8));
  menu.style.left = left + "px";
  menu.style.top = top + "px";
}

/* Copy (cut false) or cut (cut true) the current
   selection: the async Clipboard API with rich HTML
   first, plain text second, and the built in copy or
   cut command on the still standing live selection
   as the fallback, the chain the app's menus use. */
async function editorCtxCopyOrCut(cut) {
  restoreFormatSelection();
  const bodyEl = document.getElementById("noteBody");
  const range = editorCtxSelectionInBody();
  if (!range || !bodyEl) { return; }
  const holder = document.createElement("div");
  holder.appendChild(range.cloneContents());
  const html = holder.innerHTML;
  const plain = range.toString();
  let wrote = false;
  try {
    if (navigator.clipboard && navigator.clipboard.write &&
        typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html],
          { type: "text/html" }),
        "text/plain": new Blob([plain],
          { type: "text/plain" })
      })]);
      wrote = true;
    }
  } catch (err) { wrote = false; }
  if (!wrote) {
    try {
      if (navigator.clipboard &&
          navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(plain);
        wrote = true;
      }
    } catch (err) { wrote = false; }
  }
  if (!wrote) {
    try {
      wrote = document.execCommand(cut ? "cut" : "copy");
    } catch (err) { wrote = false; }
  }
  if (!wrote) {
    toast((cut ? "Cut" : "Copy") +
      " did not work in this browser.", true);
    return;
  }
  if (cut) {
    range.deleteContents();
    bodyEl.focus();
    markDirty();
  }
}

/* Paste at the caret from the clipboard, through the
   same insertion rules as the paste event (the app's
   paste modes, the code block rule included). A
   browser that refuses the read by permission gets a
   plain toast pointing at the keyboard, never a
   silent failure. */
async function editorCtxPaste() {
  restoreFormatSelection();
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl) { return; }
  let html = "";
  let plain = "";
  let read = false;
  try {
    if (navigator.clipboard && navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!html &&
            item.types.indexOf("text/html") >= 0) {
          html = await (await item.getType(
            "text/html")).text();
        }
        if (!plain &&
            item.types.indexOf("text/plain") >= 0) {
          plain = await (await item.getType(
            "text/plain")).text();
        }
      }
      read = true;
    } else if (navigator.clipboard &&
               navigator.clipboard.readText) {
      plain = await navigator.clipboard.readText();
      read = true;
    }
  } catch (err) { read = false; }
  if (!read) {
    toast("The browser would not hand over the " +
      "clipboard. Paste from the keyboard instead: " +
      "Ctrl+V, or Cmd+V on a Mac.", true);
    return;
  }
  if (!html && !plain) { return; }
  bodyEl.focus();
  const codePre = codeBlockAtSelection();
  if (codePre && plain) {
    if (insertPlainTextIntoCode(codePre, plain)) {
      markDirty();
      return;
    }
  }
  const insertHtml = html
    ? renderPasteForMode(
        ["source", "merge", "text"].indexOf(
          state.defaultPasteMode) >= 0
          ? state.defaultPasteMode : "source",
        html, plain)
    : null;
  let inserted = false;
  try {
    if (typeof document.execCommand === "function") {
      inserted = insertHtml !== null
        ? document.execCommand("insertHTML", false,
            insertHtml)
        : document.execCommand("insertText", false,
            plain);
    }
  } catch (err) { inserted = false; }
  if (!inserted) {
    /* The built in insertion is unavailable or refused:
       insert at the live range by hand, the same nodes
       the command would have placed. */
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      let lastNode = null;
      if (insertHtml !== null) {
        const holder = document.createElement("div");
        holder.innerHTML = insertHtml;
        const frag = document.createDocumentFragment();
        while (holder.firstChild) {
          lastNode = holder.firstChild;
          frag.appendChild(holder.firstChild);
        }
        range.insertNode(frag);
      } else {
        lastNode = document.createTextNode(plain);
        range.insertNode(lastNode);
      }
      if (lastNode) {
        const after = document.createRange();
        after.setStartAfter(lastNode);
        after.collapse(true);
        sel.removeAllRanges();
        sel.addRange(after);
      }
      inserted = true;
    }
  }
  if (inserted) { markDirty(); }
}

/* Run one menu item. Encrypt is the identical flow to
   the toolbar More menu's item (the same function);
   the vault item runs exactly the unlock and lock
   actions the Settings row runs. */
function runEditorCtxAction(action) {
  closeEditorCtxMenu();
  if (action === "cut") {
    void editorCtxCopyOrCut(true);
    return;
  }
  if (action === "copy") {
    void editorCtxCopyOrCut(false);
    return;
  }
  if (action === "paste") {
    void editorCtxPaste();
    return;
  }
  if (action === "encrypt") {
    restoreFormatSelection();
    void ssencEncryptSelectionFlow();
    return;
  }
  if (action === "vault") {
    if (ssencKey) { void ssencLockVault(); }
    else { void ssencUnlockFlow(); }
  }
}

/* v2.101.0: the Numbering style submenu's machinery.
   The styles, in menu order: a key is both the
   list-style-type value it names and the tail of the
   class that carries the choice on the ol
   (ss-num-<key>), the form the save funnel keeps and
   the editor and print stylesheets read. */
const NUM_STYLE_KEYS = ["decimal", "upper-alpha",
  "lower-alpha", "upper-roman", "lower-roman"];

/* The numbered list level the caret is in: the ol
   that directly holds the caret's item, or null.
   Only the caret's own level is ever restyled; a
   nested level is its own list, with its own style
   and its own defaults. */
function numberedListAtCaret() {
  const bodyEl = document.getElementById("noteBody");
  const sel = window.getSelection();
  if (!bodyEl || !sel || !sel.rangeCount) { return null; }
  const range = sel.getRangeAt(0);
  if (!bodyEl.contains(range.startContainer)) {
    return null;
  }
  let node = range.startContainer;
  if (node.nodeType !== 1) { node = node.parentNode; }
  const li = node && node.closest ? node.closest("li") : null;
  if (!li || !bodyEl.contains(li)) { return null; }
  const list = li.parentElement;
  return list && list.tagName === "OL" ? list : null;
}

/* A level's current style: its chosen class when it
   carries one, otherwise the depth default the
   stylesheet applies (numbers, lowercase letters,
   lowercase Roman numerals, cycling every three
   levels, counted through whatever lists the level
   is nested in). */
function numberingStyleOf(ol) {
  for (let i = 0; i < NUM_STYLE_KEYS.length; i++) {
    if (ol.classList.contains("ss-num-" + NUM_STYLE_KEYS[i])) {
      return NUM_STYLE_KEYS[i];
    }
  }
  const bodyEl = document.getElementById("noteBody");
  let depth = 1;
  let n = ol.parentElement;
  while (n && n !== bodyEl) {
    if (n.tagName === "UL" || n.tagName === "OL") {
      depth++;
    }
    n = n.parentElement;
  }
  return ["decimal", "lower-alpha", "lower-roman"][
    (depth - 1) % 3];
}

/* Apply one style to the caret's numbered level:
   exactly one ss-num-* class on that ol, the choice
   the save funnel keeps and a reopen renders back.
   The list's other levels keep their own styles and
   defaults. */
function applyNumberingStyle(key) {
  closeEditorCtxMenu();
  restoreFormatSelection();
  const ol = numberedListAtCaret();
  if (!ol || NUM_STYLE_KEYS.indexOf(key) === -1) {
    return;
  }
  NUM_STYLE_KEYS.forEach(function (k) {
    ol.classList.remove("ss-num-" + k);
  });
  ol.classList.add("ss-num-" + key);
  markDirty();
}

/* v2.109.0: the floating Back to top button (Chris's
   checklist item). It stands only while the editor is
   scrolled down past about one viewport of the note,
   and clicking it returns the reader smoothly to the
   top. The scroll listener is passive and only ever
   toggles the button's hidden class; the button lives
   in #editorWrap outside the scrolling flow, so it
   never moves with the note, never covers the
   scrollbar (its CSS keeps it 28px off the right
   edge), and hides itself again the moment the top
   is reached, including the note switch renders
   that zero the scroll. It is navigation, not
   editing, so it serves locked notes too. */
function wireEditorUpButton() {
  const btn = document.getElementById("editorUpBtn");
  const scroller = document.querySelector(
    ".editor-scroll");
  if (!btn || !scroller) { return; }
  const update = function () {
    btn.classList.toggle("hidden",
      scroller.scrollTop <= scroller.clientHeight);
  };
  scroller.addEventListener("scroll", update,
    { passive: true });
  btn.addEventListener("click", function () {
    scroller.scrollTo({ top: 0, behavior: "smooth" });
  });
  update();
}

function wireEditorCtxMenu() {
  const bodyEl = document.getElementById("noteBody");
  const menu = editorCtxMenuEl();
  if (!bodyEl || !menu) { return; }
  /* The menu takes the mention popups' move: directly
     under the document body, so no editor ancestor's
     stacking or parked hidden state can clip or bury
     it. appendChild moves the element with its
     listeners intact. */
  if (menu.parentElement !== document.body) {
    document.body.appendChild(menu);
  }
  /* Spell check is pinned on for the note editor (see
     this section's header): the markup carries
     spellcheck="true" and the wiring sets it again,
     and nothing in the app turns it off. */
  bodyEl.setAttribute("spellcheck", "true");
  bodyEl.addEventListener("contextmenu", function (ev) {
    /* A read only (locked) note keeps the standing
       behavior: no app menu, and the document guard's
       blanket suppression stands. */
    if (bodyEl.contentEditable === "false") { return; }
    /* Task rows inside the body keep their standing
       no menu rule; the document guard answers them. */
    if (ev.target && ev.target.closest &&
        ev.target.closest(".task-row, .task-cal-entry")) {
      return;
    }
    ev.preventDefault();
    saveFormatSelection();
    openEditorCtxMenu(ev.clientX, ev.clientY);
  });
  bodyEl.addEventListener("keydown", function (ev) {
    if (bodyEl.contentEditable === "false") { return; }
    if (ev.key === "ContextMenu" ||
        (ev.shiftKey && ev.key === "F10")) {
      ev.preventDefault();
      saveFormatSelection();
      let x = 16;
      let y = 16;
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        try {
          const rect = sel.getRangeAt(0)
            .getBoundingClientRect();
          if (rect.left || rect.bottom) {
            x = rect.left;
            y = rect.bottom;
          }
        } catch (err) {
          /* No range geometry on this surface: the
             menu opens at its fallback corner. */
        }
      }
      openEditorCtxMenu(x, y);
    }
  });
  /* A press on the menu itself must not move focus out
     of the editor: swallow its mousedown so the live
     selection stands, then let the click run the
     item. */
  menu.addEventListener("mousedown", function (ev) {
    ev.preventDefault();
  });
  menu.addEventListener("click", function (ev) {
    /* v2.101.0: a Numbering style pick applies its
       style and closes the menu (inside
       applyNumberingStyle); the Numbering style
       parent item only opens or closes its submenu,
       in place, and never runs an action. */
    const styleBtn = ev.target.closest("[data-num-style]");
    if (styleBtn) {
      applyNumberingStyle(
        styleBtn.getAttribute("data-num-style"));
      return;
    }
    /* v2.109.0: a Format submenu pick runs the
       toolbar's own command on the menu's preserved
       selection (runToolbarCommand restores it), with
       the menu closing first, the runEditorCtxAction
       shape. */
    const fmtBtn = ev.target.closest("[data-format-cmd]");
    if (fmtBtn) {
      closeEditorCtxMenu();
      runToolbarCommand(
        fmtBtn.getAttribute("data-format-cmd"));
      return;
    }
    const btn = ev.target.closest("[data-ctx-action]");
    if (!btn || btn.disabled) { return; }
    if (btn.getAttribute("data-ctx-action") === "numstyle") {
      const sub = menu.querySelector("#editorCtxNumMenu");
      if (sub) { sub.classList.toggle("hidden"); }
      const fmtSub = menu.querySelector(
        "#editorCtxFormatMenu");
      if (fmtSub) { fmtSub.classList.add("hidden"); }
      return;
    }
    if (btn.getAttribute("data-ctx-action") === "format") {
      const sub = menu.querySelector(
        "#editorCtxFormatMenu");
      if (sub) { sub.classList.toggle("hidden"); }
      const numSub = menu.querySelector(
        "#editorCtxNumMenu");
      if (numSub) { numSub.classList.add("hidden"); }
      return;
    }
    runEditorCtxAction(btn.getAttribute("data-ctx-action"));
  });
  document.addEventListener("pointerdown", function (ev) {
    if (editorCtxMenuIsOpen() &&
        !menu.contains(ev.target)) {
      closeEditorCtxMenu();
    }
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { closeEditorCtxMenu(); }
  });
}

function wireEvents() {
  /* v2.28.2: the "@" mention popup moves to the top level of
     the page before anything can open it. In the markup it
     sits inside #editorWrap (below, beside #noteBody), but
     renderEditor parks the hidden class on #editorWrap
     whenever no note is open, a catalog shell is loading,
     or a Things to do page owns the pane, and hidden is
     display none with important: in the Tasks view the
     popup therefore opened inside a subtree that could
     never paint, which is why @ in a task description
     still did nothing on v2.28.1 even after its layer was
     raised over the task modal. The card is position
     fixed, so living directly under the body changes
     nothing about where it paints or how it looks in
     either host, and appendChild moves the element with
     its listeners intact (the popup's own listeners are
     wired further down this function, by id, after this
     move; every other reference to the popup is by id or
     through an event target's closest). */
  const mentionPopupHome = document.getElementById("mentionPopup");
  if (mentionPopupHome &&
      mentionPopupHome.parentElement !== document.body) {
    document.body.appendChild(mentionPopupHome);
  }
  /* v2.83: the "^" and "#" popups take the same move,
     for the same reason. */
  ["eventLinkPopup", "tagLinkPopup"].forEach(function (id) {
    const el = document.getElementById(id);
    if (el && el.parentElement !== document.body) {
      document.body.appendChild(el);
    }
  });

  /* v2.102.0: the voice bar takes the same move, for the
     same reason and one sharper one. On the phone a
     recording starts with the keyboard up, and a fixed
     card parented inside the editor's scrolling region
     is the arrangement whose paint and tap region can
     part ways in that state: on 2026-11-03 Chris's bar
     stood fully visible at the caret with both its
     buttons dead to taps, while the same taps in a
     desktop engine landed on the buttons themselves.
     At the body's top level the bar's paint and its tap
     region are one rectangle, the standing the popups'
     move already proved. The bar is found by id
     everywhere it is used, so the move changes nothing
     else about it. */
  const voiceBarHome = document.getElementById("voiceBar");
  if (voiceBarHome &&
      voiceBarHome.parentElement !== document.body) {
    document.body.appendChild(voiceBarHome);
  }

  /* Setup form (v2.0): there is nothing to fill in. Submitting
     creates this device's local encryption key, saves the (Google
     only) settings shape, clears any legacy vault artifact left by
     an older build, and hands the user to the Google sign in gate,
     where the sign in itself finishes setup. */
  document.getElementById("setupForm").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    const errEl = document.getElementById("setupError");
    errEl.textContent = "";
    try {
      state.repoExists = false;
      localStorage.removeItem(LS_LEGACY_VAULT);
      await createDeviceKey();
      saveSettings();
      showGoogleConnectScreen(
        "One step left: sign in with Google. SnakeScale Notes will create " +
        "the SnakeScale Notes folder in your Drive and your first " +
        "notebook and starter note.");
    } catch (err) {
      errEl.textContent = "Setup failed: " + err.message;
    }
  });


  /* The Google sign in gate button. There is no client ID field on
     this screen and no token request behind this button anymore:
     since v2.79.0 the click navigates the browser to the
     ssnotes-auth Worker's /login route, Google signs the user in
     there, and the Worker returns the browser to this address
     with the outcome in the fragment, which the next boot's
     fragment reader settles. The fresh route stands in when a
     reauth answer armed it. */
  document.getElementById("googleBackendConnectBtn").addEventListener("click", function () {
    const errEl = document.getElementById("repoError");
    errEl.textContent = "";
    const btn = document.getElementById("googleBackendConnectBtn");
    btn.disabled = true;
    btn.textContent = "Opening Google sign in...";
    navigateToWorkerLogin();
  });
  document.getElementById("repoRetryBtn").addEventListener("click", function () {
    connectAndLoad().catch(function (err) { toast(err.message, true); });
  });
  document.getElementById("repoLockBtn").addEventListener("click", function () {
    signOut().catch(function (err) { toast(err.message, true); });
  });

  /* Sidebar: view switching. */
  /* v2.33: Home, the first entry: the dashboard, the
     same one line navigation as its neighbours. */
  document.getElementById("navHome").addEventListener("click", function () {
    state.view = { kind: "home", value: null };
    renderAll();
    setMobileView("list");
  });
  document.getElementById("navAll").addEventListener("click", function () {
    state.view = { kind: "all", value: null };
    renderAll();
    setMobileView("list");
  });
  /* v2.55: the Home header's pencil opens a customize
     session; Widgets opens the widget popover, and
     Done and Cancel close the session (see
     enterHomeCustomize and exitHomeCustomize). The
     popover closes on an outside click and on
     Escape, the app menus' own rule; clicks on the
     popover and on the bar that owns it are its own
     business (Done and Cancel close it themselves by
     ending the session). */
  document.getElementById("homeCustomizeBtn").addEventListener("click", function () {
    enterHomeCustomize();
  });
  document.getElementById("homeWidgetsBtn").addEventListener("click", function () {
    toggleHomeWidgetsPopover();
  });
  document.getElementById("homeCustomizeDoneBtn").addEventListener("click", function () {
    exitHomeCustomize(true);
  });
  document.getElementById("homeCustomizeCancelBtn").addEventListener("click", function () {
    exitHomeCustomize(false);
  });
  document.addEventListener("click", function (ev) {
    if (!homeWidgetsPopoverOpen) { return; }
    const t = ev.target;
    if (!t || !t.closest) { return; }
    /* A target no longer in the document was replaced
       by the re-render its own click caused (the
       popover's rows rebuild on every render): that
       click was the popover's own business, never an
       outside one. */
    if (!document.contains(t)) { return; }
    if (t.closest("#homeWidgetsPopover") ||
        t.closest("#homeCustomizeBar")) { return; }
    closeHomeWidgetsPopover();
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { closeHomeWidgetsPopover(); }
  });
  /* v2.81: the Calendar entry opens the Tasks view with
     its calendar mode active, exactly as if the view
     had been opened and its Calendar segment pressed;
     the mode is the session state the view already
     keeps, and the Tasks entry's own behavior below is
     unchanged. */
  document.getElementById("navCalendar").addEventListener("click", function () {
    state.view = { kind: "tasks", value: null };
    state.tasksView.mode = "calendar";
    renderAll();
    setMobileView("list");
  });
  /* v2.24: the Tasks entry under All Notes opens the Tasks
     view, the same one line navigation as its neighbours. */
  document.getElementById("navTasks").addEventListener("click", function () {
    state.view = { kind: "tasks", value: null };
    renderAll();
    setMobileView("list");
  });
  document.getElementById("navPinned").addEventListener("click", function () {
    state.view = { kind: "pinned", value: null };
    renderAll();
    setMobileView("list");
  });
  /* v2.35: the Reminders entry opens the Reminders view,
     the same one line navigation as its neighbours. */
  document.getElementById("navReminders").addEventListener("click", function () {
    state.view = { kind: "reminders", value: null };
    renderAll();
    setMobileView("list");
  });
  document.getElementById("navTrash").addEventListener("click", function () {
    state.view = { kind: "trash", value: null };
    renderAll();
    setMobileView("list");
  });
  document.getElementById("navArchive").addEventListener("click", function () {
    state.view = { kind: "archive", value: null };
    renderAll();
    setMobileView("list");
  });

  document.getElementById("addNotebookBtn").addEventListener("click", function () {
    const name = prompt("New notebook name");
    if (name && name.trim()) {
      createNotebook(name.trim()).catch(function (err) {
        toast("Could not create notebook: " + err.message, true);
      });
    }
  });

  /* v2.62: the sidebar section fold toggles, one per
     section in the table, each folding its own section. */
  SIDEBAR_SECTIONS.forEach(function (spec) {
    document.getElementById(spec.toggleId).addEventListener(
      "click", function () { toggleSidebarSection(spec.key); });
  });

  document.getElementById("newNoteBtn").addEventListener("click", function () {
    const slug = state.view.kind === "notebook" ? state.view.value :
      fallbackNotebookSlug();
    createNoteInRepo(slug).catch(function (err) {
      toast("Could not create the note: " + err.message, true);
    });
  });

  /* v1.8: notes list toolbar wiring. The list New Note button makes
     the same notebook choice as the sidebar button above (the current
     notebook, else the default notebook) through the same instant
     create path; its disabled state in Trash and the Archive is set
     by renderListToolbar, and a disabled button fires no click. */
  document.getElementById("listNewNoteBtn").addEventListener("click", function () {
    const slug = state.view.kind === "notebook" ? state.view.value :
      fallbackNotebookSlug();
    createNoteInRepo(slug).catch(function (err) {
      toast("Could not create the note: " + err.message, true);
    });
  });
  document.getElementById("listFilterBtn").addEventListener("click", function () {
    toggleListPanel("filterPanel");
  });
  document.getElementById("listSortBtn").addEventListener("click", function () {
    toggleListPanel("sortMenu");
  });
  document.getElementById("listNbMenuBtn").addEventListener("click", function () {
    toggleListPanel("nbActionMenu");
  });
  /* Filter date inputs write straight into filter state and
     re-render the list. Both input and change are heard (date
     pickers fire them in different orders across browsers); the
     write is idempotent. The panel stays open through all of it. */
  [["filterCreatedFrom", "createdFrom"], ["filterCreatedTo", "createdTo"],
   ["filterUpdatedFrom", "updatedFrom"], ["filterUpdatedTo", "updatedTo"]]
    .forEach(function (pair) {
      const input = document.getElementById(pair[0]);
      ["input", "change"].forEach(function (eventName) {
        input.addEventListener(eventName, function (ev) {
          state.listFilters[pair[1]] = ev.target.value || "";
          renderNoteList();
        });
      });
    });
  document.getElementById("filterClearBtn").addEventListener("click", function () {
    clearListFilters();
  });
  /* Sort menu items: one listener per field button. */
  document.querySelectorAll("#sortMenu [data-sort]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      chooseListSort(btn.getAttribute("data-sort"));
    });
  });
  /* Notebook menu items act on the notebook of the current view.
     renderListToolbar keeps them disabled outside a notebook view,
     so these handlers can trust the view; the guard stays as a
     second line of defense. */
  document.getElementById("nbRenameBtn").addEventListener("click", function () {
    if (state.view.kind !== "notebook") { return; }
    closeListPanels();
    promptRenameNotebook(state.view.value);
  });
  document.getElementById("nbDeleteBtn").addEventListener("click", function () {
    if (state.view.kind !== "notebook") { return; }
    closeListPanels();
    confirmDeleteNotebook(state.view.value);
  });
  /* v2.29: the stack items on the same menu. Add opens the stack
     panel (the shared toggle closes the action menu as it opens
     the panel); Remove acts at once, like Evernote's, with no
     confirm, because nothing is deleted and re-adding is one
     menu away. */
  document.getElementById("nbAddToStackBtn").addEventListener("click", function () {
    if (state.view.kind !== "notebook") { return; }
    toggleListPanel("nbStackPanel");
  });
  document.getElementById("nbRemoveFromStackBtn").addEventListener("click", function () {
    if (state.view.kind !== "notebook") { return; }
    closeListPanels();
    setNotebookStack(state.view.value, null).catch(function (err) {
      toast("Remove from stack failed: " + err.message, true);
    });
  });
  /* v2.63: Move to... opens the parent panel (the shared
     toggle closes the action menu as it opens the panel,
     exactly like Add to Stack). */
  document.getElementById("nbMoveBtn").addEventListener("click", function () {
    if (state.view.kind !== "notebook") { return; }
    toggleListPanel("nbParentPanel");
  });
  /* v2.29: the stack header menu's items act on the stack the
     menu was opened for (stackMenuFor), captured before the menu
     closes so the flow functions read a settled name. */
  document.getElementById("stackRenameBtn").addEventListener("click", function () {
    const name = stackMenuFor;
    closeStackMenu();
    if (name) { promptRenameStack(name); }
  });
  document.getElementById("stackDeleteBtn").addEventListener("click", function () {
    const name = stackMenuFor;
    closeStackMenu();
    if (name) { confirmDeleteStack(name); }
  });
  /* The stack menu's closers: a click outside the notebooks
     section (and not on a stack's menu button, whose own handler
     toggles) closes it, and so does Escape. */
  document.addEventListener("click", function (ev) {
    if (stackMenuFor === null) { return; }
    if (ev.target.closest("#stackMenu")) { return; }
    if (ev.target.closest(".nav-stack-menu-btn")) { return; }
    if (ev.target.closest("#notebookNav")) { return; }
    closeStackMenu();
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { closeStackMenu(); }
  });
  /* v2.30: the tag row menu's items act on the tag the menu
     was opened for (tagMenuFor), captured before the menu
     closes so the flow functions read a settled name. Move
     Tag keeps the panel's own variable (tagPanelFor) when it
     swaps the menu for the parent panel. */
  document.getElementById("tagRenameBtn").addEventListener("click", function () {
    const name = tagMenuFor;
    closeTagMenu();
    if (name) { promptRenameTag(name); }
  });
  document.getElementById("tagMoveBtn").addEventListener("click", function () {
    const name = tagMenuFor;
    if (name) { openTagParentPanel(name); }
  });
  document.getElementById("tagTopLevelBtn").addEventListener("click", function () {
    const name = tagMenuFor;
    closeTagMenu();
    if (name) {
      setTagParent(name, null).catch(function (err) {
        toast("Move tag failed: " + err.message, true);
      });
    }
  });
  document.getElementById("tagDeleteBtn").addEventListener("click", function () {
    const name = tagMenuFor;
    closeTagMenu();
    if (name) { confirmDeleteTag(name); }
  });
  /* v2.31: the tag menu's shortcut item acts on the tag the
     menu was opened for, captured before the menu closes. */
  document.getElementById("tagShortcutBtn").addEventListener("click", function () {
    const name = tagMenuFor;
    closeTagMenu();
    if (name) { toggleShortcut("tag", name); }
  });
  /* v2.31: the shortcut row menu's one item removes the
     shortcut the menu was opened for. The target is never
     touched; removeShortcut only drops the entry. */
  document.getElementById("shortcutRemoveBtn").addEventListener("click", function () {
    const entry = shortcutMenuFor;
    closeShortcutMenu();
    if (entry) { removeShortcut(entry.kind, entry.id); }
  });
  /* The shortcut menu's closers, mirroring the tag menu's:
     a click outside the menu and its rows' menu buttons
     closes it, and so does Escape. */
  document.addEventListener("click", function (ev) {
    if (shortcutMenuFor === null) { return; }
    if (ev.target.closest("#shortcutMenu")) { return; }
    if (ev.target.closest(".nav-shortcut-menu-btn")) { return; }
    closeShortcutMenu();
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { closeShortcutMenu(); }
  });
  /* The tag menu and parent panel closers, mirroring the
     stack menu's: a click outside the menu, the panel, and a
     tag's menu button closes both, and so does Escape. A
     click on another tag row closes them too: the row's own
     filter is the click's meaning, as with any outside
     click. */
  document.addEventListener("click", function (ev) {
    if (tagMenuFor === null && tagPanelFor === null) { return; }
    if (ev.target.closest("#tagMenu")) { return; }
    if (ev.target.closest("#tagParentPanel")) { return; }
    if (ev.target.closest(".nav-tag-menu-btn")) { return; }
    closeTagMenu();
    closeTagParentPanel();
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") {
      closeTagMenu();
      closeTagParentPanel();
    }
  });
  /* v2.2: the pin item. It belongs to the selected note, not to a
     view, so there is no view guard here: renderListToolbar hides
     it in Trash and Archive and disables it unless a live note is
     selected, and toggleSelectedNotePin re-checks the selection. */
  document.getElementById("nbPinBtn").addEventListener("click", function () {
    closeListPanels();
    toggleSelectedNotePin().catch(function (err) { toast(err.message, true); });
  });
  /* v2.31: the same menu's shortcut items. The notebook
     item acts on the notebook of the current view, like
     the rename and stack items above it; the note item
     belongs to the selected note, like the pin item, and
     re-checks that the selection is a live note. */
  document.getElementById("nbShortcutNbBtn").addEventListener("click", function () {
    if (state.view.kind !== "notebook") { return; }
    closeListPanels();
    toggleShortcut("notebook", state.view.value);
  });
  document.getElementById("nbShortcutNoteBtn").addEventListener("click", function () {
    closeListPanels();
    const note = currentNote();
    if (!note || state.notes.indexOf(note) < 0) { return; }
    toggleShortcut("note", note.id);
  });
  /* v2.58: the Pin to Home item's listener is gone with
     the item. */
  /* v2.35: the same menu's Reminder item opens the one
     reminder panel for the selected note, re-checking the
     selection the way the pin items do. */
  document.getElementById("nbReminderBtn").addEventListener("click", function () {
    closeListPanels();
    const note = currentNote();
    if (!note || state.notes.indexOf(note) < 0) { return; }
    openNoteReminderPanel(note.id);
  });
  /* v2.38: the notes list menu's Save as Template item:
     the same close the panels, then act shape as the
     reminder item above it. The flow is async (a shell's
     body completes first), with failures landing in a
     toast. */
  document.getElementById("nbSaveTemplateBtn").addEventListener("click", function () {
    closeListPanels();
    promptSaveNoteAsTemplate().catch(function (err) {
      toast(err.message, true);
    });
  });
  /* v2.39: the notes list menu's Duplicate note item: the
     same close the panels, then act shape. The item's show
     and enable rule in renderListToolbar already restricts
     it to a live selected note; the guard here is the second
     line of defense, mirroring the Trash items below. */
  document.getElementById("nbDuplicateBtn").addEventListener("click", function () {
    closeListPanels();
    const note = currentNote();
    if (note && state.notes.indexOf(note) >= 0) {
      duplicateNote(note).catch(function (err) {
        toast(err.message, true);
      });
    }
  });
  /* v2.39: the notes list menu's Merge Selected item, the
     live views' bulk action; mergeSelectedNotes validates
     the selection itself and names every refusal. */
  document.getElementById("nbMergeSelectedBtn").addEventListener("click", function () {
    closeListPanels();
    mergeSelectedNotes().catch(function (err) {
      toast(err.message, true);
    });
  });
  /* v2.41: the notes list menu's Create Table of Contents
     Note item, beside Merge Selected;
     createTableOfContentsNote validates the selection
     itself and names every refusal or leftover. */
  document.getElementById("nbTocNoteBtn").addEventListener("click", function () {
    closeListPanels();
    createTableOfContentsNote().catch(function (err) {
      toast(err.message, true);
    });
  });
  /* v2.38: the sidebar's Templates button opens the one
     gallery; the gallery's own Close button and a
     backdrop click close it, the modal family's
     established gestures. */
  document.getElementById("templatesBtn").addEventListener("click", function () {
    openTemplateGallery();
  });
  document.getElementById("templateCloseBtn").addEventListener("click", function () {
    closeTemplateGallery();
  });
  document.getElementById("templateModal").addEventListener("click", function (ev) {
    if (ev.target === ev.currentTarget) { closeTemplateGallery(); }
  });
  /* v2.42: the merge order dialog's buttons, backdrop,
     and Escape. Merge confirms the order the rows stand
     in; everything else cancels, and a cancel changes
     nothing. Escape is the dialog's own only while it is
     the open surface (an engaged row drag takes Escape
     first, in the drag helper's capture listener, and
     merely ends the drag). */
  document.getElementById("mergeOrderConfirmBtn").addEventListener("click", function () {
    confirmMergeOrderDialog();
  });
  document.getElementById("mergeOrderCancelBtn").addEventListener("click", function () {
    closeMergeOrderDialog(null);
  });
  document.getElementById("mergeOrderModal").addEventListener("click", function (ev) {
    if (ev.target === ev.currentTarget) { closeMergeOrderDialog(null); }
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") { return; }
    const modal = document.getElementById("mergeOrderModal");
    if (modal && !modal.classList.contains("hidden") &&
        !ssReorderDrag) {
      closeMergeOrderDialog(null);
    }
  });
  /* v2.45: the scan dialog's wiring: the two capture
     doors, the page controls, the enhancement segmented
     control, the corner handles, and the modal family's
     backdrop and Escape gestures (a cancel, so an
     accidental dismissal discards the scan and uploads
     nothing, exactly like the Cancel button). */
  document.getElementById("scanCameraInput")
    .addEventListener("change", onScanInputChange);
  document.getElementById("scanPickInput")
    .addEventListener("change", onScanInputChange);
  document.getElementById("scanCameraBtn").addEventListener("click", function () {
    if (!scanState) { return; }
    scanState.replaceArmed = false;
    document.getElementById("scanCameraInput").click();
  });
  document.getElementById("scanPickBtn").addEventListener("click", function () {
    if (!scanState) { return; }
    scanState.replaceArmed = false;
    document.getElementById("scanPickInput").click();
  });
  document.getElementById("scanRetakeBtn").addEventListener("click", function () {
    if (!scanState || !scanCurrentPage()) { return; }
    scanState.replaceArmed = true;
    document.getElementById("scanCameraInput").click();
  });
  document.getElementById("scanRemovePageBtn").addEventListener("click", function () {
    if (!scanState || !scanCurrentPage()) { return; }
    const gone = scanState.pages.splice(scanState.current, 1)[0];
    if (gone) {
      try { URL.revokeObjectURL(gone.url); } catch (err) { /* gone */ }
    }
    if (scanState.current >= scanState.pages.length) {
      scanState.current = Math.max(0, scanState.pages.length - 1);
    }
    renderScanDialog();
  });
  document.getElementById("scanModeColorBtn").addEventListener("click", function () {
    if (!scanState) { return; }
    scanState.mode = "color";
    renderScanDialog();
  });
  document.getElementById("scanModeDocumentBtn").addEventListener("click", function () {
    if (!scanState) { return; }
    scanState.mode = "document";
    renderScanDialog();
  });
  document.getElementById("scanCancelBtn").addEventListener("click", function () {
    closeScanDialog();
  });
  document.getElementById("scanInsertBtn").addEventListener("click", function () {
    confirmScanDialog();
  });
  document.getElementById("scanModal").addEventListener("click", function (ev) {
    if (ev.target === ev.currentTarget) { closeScanDialog(); }
  });
  document.querySelectorAll("#scanStage .scan-handle")
    .forEach(function (h) {
      h.addEventListener("pointerdown", onScanHandlePointerDown);
    });
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") { return; }
    const modal = document.getElementById("scanModal");
    if (modal && !modal.classList.contains("hidden") && !scanDrag) {
      closeScanDialog();
    }
  });
  /* v2.46: the sketch dialog's wiring: the canvas's pointer
     path, the tool, color, and thickness controls, Undo and
     Clear, and the modal family's backdrop and Escape
     gestures (a cancel, so an accidental dismissal discards
     the drawing and uploads nothing, exactly like the
     Cancel button). Picking a color also picks the pen:
     colors belong to the pen, and a color tap while erasing
     means the drawing hand is back. */
  document.getElementById("sketchCanvas")
    .addEventListener("pointerdown", onSketchPointerDown);
  document.getElementById("sketchCanvas")
    .addEventListener("pointermove", onSketchPointerMove);
  document.getElementById("sketchCanvas")
    .addEventListener("pointerup", onSketchPointerUp);
  document.getElementById("sketchCanvas")
    .addEventListener("pointercancel", onSketchPointerUp);
  document.getElementById("sketchPenBtn").addEventListener("click", function () {
    if (!sketchState) { return; }
    sketchState.tool = "pen";
    renderSketchDialog();
  });
  document.getElementById("sketchEraserBtn").addEventListener("click", function () {
    if (!sketchState) { return; }
    sketchState.tool = "eraser";
    renderSketchDialog();
  });
  document.querySelectorAll("#sketchTools .sketch-color")
    .forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!sketchState) { return; }
        sketchState.color = btn.getAttribute("data-sketch-color");
        sketchState.tool = "pen";
        renderSketchDialog();
      });
    });
  document.querySelectorAll("#sketchTools .sketch-width-btn")
    .forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!sketchState) { return; }
        sketchState.widthPx = Number(btn.getAttribute("data-sketch-width"));
        renderSketchDialog();
      });
    });
  document.getElementById("sketchUndoBtn").addEventListener("click", function () {
    sketchUndoLast();
  });
  document.getElementById("sketchClearBtn").addEventListener("click", function () {
    sketchClearStrokes();
  });
  document.getElementById("sketchCancelBtn").addEventListener("click", function () {
    closeSketchDialog();
  });
  document.getElementById("sketchSaveBtn").addEventListener("click", function () {
    saveSketchDialog();
  });
  document.getElementById("sketchModal").addEventListener("click", function (ev) {
    if (ev.target === ev.currentTarget) { closeSketchDialog(); }
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") { return; }
    const modal = document.getElementById("sketchModal");
    if (modal && !modal.classList.contains("hidden")) {
      closeSketchDialog();
    }
  });
  /* v2.38: the gallery entry menu's Rename and Delete,
     the saved search menu's handlers in shape: resolve
     the row's template, close the menu first, then the
     native prompt or confirm, then the store path, then
     re-render the gallery so the change shows where the
     user is looking. */
  document.getElementById("templateRenameBtn").addEventListener("click", function () {
    const entry = customTemplateById(templateMenuFor);
    closeTemplateMenu();
    if (!entry) { return; }
    const next = prompt("Rename template", entry.name);
    if (next === null) { return; }
    if (renameTemplate(entry.id, next)) {
      renderTemplateGallery();
    }
  });
  document.getElementById("templateDeleteBtn").addEventListener("click", function () {
    const entry = customTemplateById(templateMenuFor);
    closeTemplateMenu();
    if (!entry) { return; }
    if (!confirm("Delete the template \"" + entry.name +
      "\"? Notes you made from it stay as they are.")) {
      return;
    }
    if (deleteTemplate(entry.id)) {
      renderTemplateGallery();
    }
  });
  /* v2.35: the editor footer's Reminder button opens the
     same panel for the open note. */
  document.getElementById("noteReminderBtn").addEventListener("click", function () {
    if (!state.selectedId) { return; }
    openNoteReminderPanel(state.selectedId);
  });
  /* v2.36: the backlinks bar's toggle folds and unfolds its
     list; the entries' own clicks are wired per render (see
     renderBacklinks), the way the notebook menu wires its
     items per open. */
  document.getElementById("backlinksToggle").addEventListener("click", function () {
    backlinksOpen = !backlinksOpen;
    renderBacklinks();
  });
  /* v2.35: the reminder panel's own controls. The quick
     choices only fill the fields; Save lands them. */
  document.getElementById("reminderCloseBtn").addEventListener("click", function () {
    closeNoteReminderPanel();
  });
  document.getElementById("reminderSaveBtn").addEventListener("click", function () {
    saveNoteReminderFromPanel();
  });
  document.getElementById("reminderDoneBtn").addEventListener("click", function () {
    markNoteReminderDoneFromPanel();
  });
  document.getElementById("reminderRemoveBtn").addEventListener("click", function () {
    removeNoteReminderFromPanel();
  });
  document.getElementById("reminderQuickTomorrow").addEventListener("click", function () {
    fillReminderQuickChoice(1);
  });
  document.getElementById("reminderQuickWeek").addEventListener("click", function () {
    fillReminderQuickChoice(7);
  });
  /* v1.8.1: the same menu's Trash and Archive items. renderListToolbar
     only shows them in their view (and disables them when they would
     have nothing to act on); the view guards stay as a second line
     of defense, mirroring the notebook items above. */
  document.getElementById("nbEmptyTrashBtn").addEventListener("click", function () {
    if (state.view.kind !== "trash") { return; }
    closeListPanels();
    emptyTrash().catch(function (err) { toast(err.message, true); });
  });
  document.getElementById("nbDeleteSelectedBtn").addEventListener("click", function () {
    if (state.view.kind !== "trash") { return; }
    closeListPanels();
    deleteSelectedTrashNotes().catch(function (err) { toast(err.message, true); });
  });
  document.getElementById("nbRestoreSelectedBtn").addEventListener("click", function () {
    if (state.view.kind !== "archive") { return; }
    closeListPanels();
    restoreSelectedArchiveNotes().catch(function (err) { toast(err.message, true); });
  });
  /* List panel closers, mirroring the editor toolbar menus: a click
     anywhere outside the list toolbar closes the open panel, and so
     does Escape. Clicks inside the toolbar (its buttons, its panels,
     the filter checkboxes and date inputs) are left alone. */
  document.addEventListener("click", function (ev) {
    if (!ev.target.closest("#listToolbar")) { closeListPanels(); }
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { closeListPanels(); }
  });

  /* Search filters locally as the user types. */
  document.getElementById("searchInput").addEventListener("input",
    debounce(function (ev) {
      state.search = ev.target.value.trim().toLowerCase();
      /* v2.33: a search typed while Home is showing lands
         on its results, the way Evernote leaves Home for
         a search; from any other view only the list
         re-renders, as always. */
      if (state.view.kind === "home" && state.search) {
        state.view = { kind: "all", value: null };
        renderAll();
        setMobileView("list");
        return;
      }
      renderNoteList();
    }, 150));
  /* v2.32: clicking into the search box surfaces the saved
     searches (Evernote surfaces its saved searches from the
     search bar), and typing re-filters the panel's rows at
     once, undebounced, since the rows are local. */
  document.getElementById("searchInput").addEventListener("focus",
    function () {
      openSavedSearchPanel();
    });
  document.getElementById("searchInput").addEventListener("click",
    function () {
      openSavedSearchPanel();
    });
  document.getElementById("searchInput").addEventListener("input",
    function () {
      const panel = document.getElementById("savedSearchPanel");
      if (panel && !panel.classList.contains("hidden")) {
        renderSavedSearchPanel();
      }
    });
  /* v2.32: the panel and its menu close on a click outside
     the search wrap, and on Escape, the closers the other
     sidebar menus keep. */
  document.addEventListener("click", function (ev) {
    if (!ev.target.closest(".sidebar-search")) {
      closeSavedSearchPanel();
    }
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { closeSavedSearchPanel(); }
  });
  /* v2.32: Save search (and Edit saved search) at the top
     of the results. */
  document.getElementById("saveSearchBtn").addEventListener("click",
    function () {
      promptSaveSearch();
    });
  /* v2.32: the saved search entry menu's items act on the
     entry the menu was opened for (savedSearchMenuFor),
     captured before the menu closes. */
  document.getElementById("savedSearchRenameBtn").addEventListener("click", function () {
    const id = savedSearchMenuFor;
    closeSavedSearchMenu();
    const entry = id ? savedSearchById(id) : null;
    if (entry) { promptRenameSavedSearch(entry); }
  });
  document.getElementById("savedSearchShortcutBtn").addEventListener("click", function () {
    const id = savedSearchMenuFor;
    closeSavedSearchMenu();
    const entry = id ? savedSearchById(id) : null;
    if (entry) { toggleShortcut("search", entry.id); }
  });
  document.getElementById("savedSearchDeleteBtn").addEventListener("click", function () {
    const id = savedSearchMenuFor;
    closeSavedSearchMenu();
    const entry = id ? savedSearchById(id) : null;
    if (entry) { confirmDeleteSavedSearch(entry); }
  });

  /* Sidebar footer: v2.7 moved the footer's buttons into the
     three dot menu beside the Synced pill (see the v2.7 block at
     openSidebarMenu), and v2.7.1 moved Sync now in as the menu's
     first item. v2.8: Refresh connection and Dark mode moved out
     of the menu into the Settings modal, and the Settings item
     below opens that modal (openSettingsModal closes the menu
     itself). The menu's open, close, and outside click wiring
     follows the notebook menu's pattern exactly; each item
     closes the menu and then runs its action. The Install app
     item is the one exception: its click is wired in the PWA
     block (wirePwaInstall), which also closes the menu. The Sync
     now item mirrors its old button exactly: the button showed
     no working state of its own (a sync in flight shows on the
     Synced pill, and syncNow itself refuses to run twice), so
     the item needs none either, only the call. */
  document.getElementById("sidebarSyncItem").addEventListener("click", function () {
    closeSidebarMenu();
    syncNow(true);
  });
  /* v2.17: Refresh connection sits under Sync now in this menu
     (the v2.15 labeled button beside the pill is gone). Like
     every item here it closes the menu first, then runs the same
     shared refreshGoogleConnection the Settings button runs; a
     run already in flight is refused by that function's own
     guard, and the run's feedback is the Synced pill and its
     closing toast. */
  document.getElementById("sidebarRefreshItem").addEventListener("click", function () {
    closeSidebarMenu();
    refreshGoogleConnection().catch(function (err) { toast(err.message, true); });
  });
  document.getElementById("sidebarMenuBtn").addEventListener("click", function (ev) {
    ev.stopPropagation();
    toggleSidebarMenu();
  });
  /* v2.50: the New version ready pill in the sync row.
     Its click asks the self update machinery to land the
     waiting reload now; the machinery's own rules decide
     (see onUpdateReadyPillClick). */
  document.getElementById("updateReadyPill").addEventListener("click", function () {
    onUpdateReadyPillClick();
  });
  /* v2.57: tapping a sticky save pill (a failure, an
     offline queue, a pause) dismisses it until the
     state changes; the transient tones take no pointer
     events, so this fires only for the sticky ones
     (see dismissSavePill). */
  document.getElementById("savePill").addEventListener("click", function () {
    dismissSavePill();
  });
  document.getElementById("sidebarMenu").addEventListener("click", function (ev) {
    ev.stopPropagation();
  });
  document.addEventListener("click", function (ev) {
    const menu = document.getElementById("sidebarMenu");
    if (!menu || menu.classList.contains("hidden")) { return; }
    const target = ev.target;
    /* v2.50: the "inside" test follows the menu's row,
       which moved to the top of the sidebar with the
       menu (through v2.49 the row was in .sidebar-foot). */
    if (target && target.closest && target.closest(".sync-row")) { return; }
    closeSidebarMenu();
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { closeSidebarMenu(); }
  });
  document.getElementById("sidebarSettingsItem").addEventListener("click", function () {
    openSettingsModal();
  });
  document.getElementById("sidebarSignOutItem").addEventListener("click", function () {
    closeSidebarMenu();
    signOut().catch(function (err) { toast(err.message, true); });
  });
  /* v2.18: collapse is a chevron button, not a menu item.
     v2.50: the button lives in the sidebar head, at the
     upper right corner of the logo row. It runs the same
     setSidebarRail toggle it has run since v2.18 (the
     rail's expand button runs it back), with the same
     settings persistence inside setSidebarRail. */
  document.getElementById("sidebarCollapseBtn").addEventListener("click", function () {
    setSidebarRail(true);
  });

  /* v2.8: the Settings modal's own controls, following the note
     link picker's modal pattern: the Close button, a click on
     the dimmed backdrop, or Escape closes it. The theme buttons
     set their side through the shared setTheme; the refresh
     button runs the same refreshGoogleConnection the rail's
     refresh icon calls directly (unlike sign out it wipes
     nothing: it saves the open note locally, gets a fresh
     Google token, and resyncs in place; see section 11); the
     versions input applies on change. */
  document.getElementById("settingsCloseBtn").addEventListener("click", closeSettingsModal);
  document.getElementById("settingsModal").addEventListener("click", function (ev) {
    if (ev.target === ev.currentTarget) { closeSettingsModal(); }
  });
  document.getElementById("settingsModal").addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { closeSettingsModal(); }
  });
  /* v2.54: the Settings tab strip. A click selects its tab.
     The arrow keys follow the standard tab pattern: Left
     and Right move (wrapping at the ends), Home and End
     jump, and activation follows focus, so moving and
     choosing are one act. Escape is not intercepted here:
     it bubbles to the modal's own handler above and
     closes, from a tab as from anywhere in the dialog. */
  const settingsTabsEl = document.getElementById("settingsTabs");
  if (settingsTabsEl) {
    settingsTabsEl.addEventListener("click", function (ev) {
      const btn = ev.target.closest("[data-settings-tab]");
      if (btn) {
        selectSettingsTab(btn.getAttribute("data-settings-tab"));
      }
    });
    settingsTabsEl.addEventListener("keydown", function (ev) {
      const btn = ev.target.closest("[data-settings-tab]");
      if (!btn) { return; }
      const keys = SETTINGS_TAB_KEYS;
      const at = keys.indexOf(btn.getAttribute("data-settings-tab"));
      if (at < 0) { return; }
      let next = null;
      if (ev.key === "ArrowRight") {
        next = keys[(at + 1) % keys.length];
      } else if (ev.key === "ArrowLeft") {
        next = keys[(at + keys.length - 1) % keys.length];
      } else if (ev.key === "Home") { next = keys[0]; }
      else if (ev.key === "End") { next = keys[keys.length - 1]; }
      if (next === null) { return; }
      ev.preventDefault();
      selectSettingsTab(next);
      const nextBtn = settingsTabButton(next);
      if (nextBtn) { nextBtn.focus(); }
    });
  }
  document.getElementById("settingsThemeLightBtn").addEventListener("click", function () {
    setTheme(false);
  });
  document.getElementById("settingsThemeDarkBtn").addEventListener("click", function () {
    setTheme(true);
  });
  document.getElementById("settingsRefreshBtn").addEventListener("click", function () {
    refreshGoogleConnection().catch(function (err) { toast(err.message, true); });
  });
  /* v2.80: the Google Calendar row's Connect button runs
     the consent forcing sign in (the new scope's only
     route), exactly like the calendar surfaces' caption
     button. */
  document.getElementById("settingsGcalConnectBtn").addEventListener("click", function () {
    connectGoogleCalendar();
  });
  /* v2.85: the Contacts row's buttons: Connect runs
     the consent forcing sign in (the Contacts
     grant's only route, and the repair for a grant
     the standing sign in predates), and Retry asks
     the People API again after a network failure. */
  document.getElementById("settingsPeopleConnectBtn").addEventListener("click", function () {
    connectPeopleContacts();
  });
  document.getElementById("settingsPeopleRetryBtn").addEventListener("click", function () {
    retryPeopleContacts();
  });
  /* v2.86: the Push notifications row's buttons:
     Enable asks for permission from its click when
     none has been given and then registers; Send test
     asks the Worker to push a test to this account's
     devices; Retry runs the registration again after
     an unavailable answer. */
  document.getElementById("settingsPushEnableBtn").addEventListener("click", function () {
    enablePushFromSettings().catch(function () { /* reported in the row */ });
  });
  document.getElementById("settingsPushTestBtn").addEventListener("click", function () {
    sendPushTest().catch(function () { /* reported in the row */ });
  });
  document.getElementById("settingsPushRetryBtn").addEventListener("click", function () {
    retryPushRegistration();
  });
  /* v2.81: the calendar event editor's wiring, the
     module's second half: Save and Delete run the one
     write transport, Cancel and a backdrop click close
     (the delete confirmation likewise), the error line's
     Connect button runs the consent forcing sign in, and
     the All day checkbox keeps the time inputs' state.
     A failed write reports inside the dialog, so the
     catches here are a last resort only. */
  document.getElementById("gcalEvSaveBtn").addEventListener("click", function () {
    saveGcalEventEditor().catch(function () { /* reported in the editor */ });
  });
  document.getElementById("gcalEvCancelBtn").addEventListener("click", function () {
    closeGcalEventEditor();
  });
  document.getElementById("gcalEvDeleteBtn").addEventListener("click", function () {
    deleteGcalEventFromEditor();
  });
  document.getElementById("gcalDeleteCancelBtn").addEventListener("click", function () {
    closeGcalDeleteConfirm();
  });
  document.getElementById("gcalDeleteConfirmBtn").addEventListener("click", function () {
    confirmGcalEventDelete().catch(function () { /* reported in the editor */ });
  });
  document.getElementById("gcalEvConnectBtn").addEventListener("click", function () {
    connectGoogleCalendar();
  });
  document.getElementById("gcalEvAllDayInput").addEventListener("change", function () {
    gcalEditorSyncAllDay();
  });
  /* v2.87: the Repeat controls' wiring, and the view's
     Delete series: the select shows and hides the
     extras, each Ends radio arms its own input, a
     weekday chip click toggles its day (and marks the
     set as picked by hand), and an unpicked weekday
     set follows the start date. */
  document.getElementById("gcalEvRepeatSelect").addEventListener("change", function () {
    gcalEditorSyncRepeat();
  });
  ["gcalEvRepeatEndNever", "gcalEvRepeatEndOn",
   "gcalEvRepeatEndAfter"].forEach(function (id) {
    document.getElementById(id).addEventListener("change", function () {
      gcalEditorSyncRepeatEnds();
    });
  });
  document.getElementById("gcalEvRepeatDays").addEventListener("click", function (ev) {
    const btn = ev.target.closest(".gcal-ev-day-chip");
    if (!btn) { return; }
    if (gcalEditorState) {
      gcalEditorState.repeatDaysTouched = true;
    }
    const on = !btn.classList.contains("active");
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  document.getElementById("gcalEvStartDateInput").addEventListener("change", function () {
    gcalEditorRepeatDaysFollow();
  });
  document.getElementById("gcalViewDeleteSeriesBtn").addEventListener("click", function () {
    deleteGcalSeriesFromView();
  });
  /* v2.87 Part D: the Notifications section's
     wiring: any row edit is the section's first
     touch, a row's remove button takes the row out,
     the Add link appends a row under the cap, and a
     create's calendar change reseeds an untouched
     section from the newly chosen calendar. */
  document.getElementById("gcalEvNotifRows").addEventListener("input", function () {
    gcalEditorNotifTouch();
  });
  document.getElementById("gcalEvNotifRows").addEventListener("change", function () {
    gcalEditorNotifTouch();
  });
  document.getElementById("gcalEvNotifRows").addEventListener("click", function (ev) {
    const btn = ev.target.closest(".gcal-ev-notif-remove");
    if (!btn) { return; }
    const row = btn.closest(".gcal-ev-notif-row");
    if (row) { row.remove(); }
    gcalEditorNotifTouch();
    gcalEditorSyncNotifAdd();
  });
  document.getElementById("gcalEvNotifAdd").addEventListener("click", function (ev) {
    ev.preventDefault();
    const box = document.getElementById("gcalEvNotifRows");
    if (!box || gcalNotifRowCount() >= GCAL_NOTIF_MAX_ROWS) {
      return;
    }
    box.appendChild(buildGcalNotifRow(
      { method: "popup", minutes: 30 }));
    gcalEditorNotifTouch();
    gcalEditorSyncNotifAdd();
  });
  document.getElementById("gcalEvCalendarSelect").addEventListener("change", function () {
    const st = gcalEditorState;
    if (st && st.mode === "create" && !st.notifTouched) {
      gcalEditorSeedNotifications(null);
    }
  });
  document.getElementById("gcalEventModal").addEventListener("click", function (ev) {
    if (ev.target === ev.currentTarget) { closeGcalEventEditor(); }
  });
  document.getElementById("gcalDeleteModal").addEventListener("click", function (ev) {
    if (ev.target === ev.currentTarget) { closeGcalDeleteConfirm(); }
  });
  /* v2.83: the event view's wiring, and the two Link a
     note buttons (the editor's and the view's). */
  document.getElementById("gcalEvLinkNoteBtn").addEventListener("click", function () {
    if (gcalEditorState && gcalEditorState.ev) {
      openGcalLinkNotePicker(gcalEditorState.ev, "editor");
    }
  });
  document.getElementById("gcalViewCloseBtn").addEventListener("click", function () {
    closeGcalEventView();
  });
  document.getElementById("gcalViewDeleteBtn").addEventListener("click", function () {
    deleteGcalEventFromView();
  });
  document.getElementById("gcalViewLinkNoteBtn").addEventListener("click", function () {
    if (gcalViewState && gcalViewState.ev) {
      openGcalLinkNotePicker(gcalViewState.ev, "view");
    }
  });
  /* v2.115: the event view's Copy link button, and
     the calendar entries' right click menu items (the
     menu machinery itself lives in calendar.js). */
  document.getElementById("gcalViewCopyLinkBtn").addEventListener("click", function () {
    if (gcalViewState && gcalViewState.ev) {
      copyLinkForEvent(gcalViewState.ev);
    }
  });
  document.getElementById("gcalEventMenuOpenBtn").addEventListener("click", function () {
    gcalEventMenuOpen();
  });
  document.getElementById("gcalEventMenuCopyBtn").addEventListener("click", function () {
    gcalEventMenuCopy();
  });
  document.getElementById("gcalViewModal").addEventListener("click", function (ev) {
    if (ev.target === ev.currentTarget) { closeGcalEventView(); }
  });
  /* v2.65: the orphaned attachments scan button. The scan
     runs only from this press; the function's own guard
     and its error state carry the outcomes, so the catch
     here is a last resort toast like the refresh above. */
  document.getElementById("settingsOrphanScanBtn").addEventListener("click", function () {
    runOrphanAttachmentScan().catch(function (err) { toast(err.message, true); });
  });
  /* v2.72: the Review Orphaned Files button beside Scan:
     it surfaces the kept results it stands for. */
  document.getElementById("settingsOrphanReviewBtn").addEventListener("click", function () {
    openOrphanReview();
  });
  /* v2.15's sidebarRefreshBtn wiring lived here; v2.17 removed
     that button, and its flow is run from the sidebar menu's
     Refresh connection item instead (wired with the menu items
     above). */
  document.getElementById("settingsVersionsInput").addEventListener("change",
    applyVersionsLimitFromInput);
  /* v2.16: the auto-sync toggle in Settings Connection. */
  document.getElementById("settingsAutoSyncToggle").addEventListener("change",
    applyAutoSyncFromToggle);
  /* v2.23: the Default paste select in Settings Editor. */
  document.getElementById("settingsDefaultPasteSelect")
    .addEventListener("change", applyDefaultPasteFromSelect);
  /* v2.33: the When opening select in Settings Appearance. */
  document.getElementById("settingsStartViewSelect")
    .addEventListener("change", applyStartViewFromSelect);
  /* v2.72: the Default notebook select in Settings Appearance. */
  document.getElementById("settingsDefaultNotebookSelect")
    .addEventListener("change", applyDefaultNotebookFromSelect);
  /* v2.76: the Transcription model select in Settings Editor. */
  document.getElementById("settingsTranscriptionModelSelect")
    .addEventListener("change", applySpeechModelFromSelect);
  /* v2.89: the passage encryption controls (the
     Settings row, the two dialogs, and the editor's
     delegated block and region handling). */
  wireSsencControls();
  wireEditorCtxMenu();
  /* v2.109.0: the floating Back to top button. */
  wireEditorUpButton();
  /* v2.47: the Web clipper copy button in Settings. */
  document.getElementById("webClipCopyBtn")
    .addEventListener("click", copyWebClipBookmarklet);

  /* v2.24: the Settings Notifications controls, and the task
     editor modal, following the Settings modal's own close
     patterns (Close or Cancel buttons, a click on the dimmed
     backdrop, Escape). Every field in the editor marks it
     dirty as it changes, which is what the sync refill rule
     reads; the due date and reminder fields additionally keep
     the reminder row's state (disabled select, hint, enable
     button) live. Both Enable notifications buttons ask from
     their click, as a permission request must. */
  document.getElementById("settingsNotifEnableBtn")
    .addEventListener("click", function () {
      requestNotificationPermission().catch(function () {
        renderNotificationSettings();
      });
    });
  document.getElementById("settingsTaskRemindersToggle")
    .addEventListener("change", applyTaskRemindersFromToggle);
  /* v2.35: the note reminders switch's wiring, its twin. */
  document.getElementById("settingsNoteRemindersToggle")
    .addEventListener("change", applyNoteRemindersFromToggle);
  document.getElementById("taskSaveBtn")
    .addEventListener("click", saveTaskEditor);
  document.getElementById("taskCancelBtn")
    .addEventListener("click", closeTaskEditor);
  document.getElementById("taskDeleteBtn")
    .addEventListener("click", deleteTaskFromEditor);
  document.getElementById("taskNotifEnableBtn")
    .addEventListener("click", function () {
      requestNotificationPermission().catch(function () {
        syncTaskReminderControls();
      });
    });
  document.getElementById("taskModal").addEventListener("click",
    function (ev) {
      if (ev.target === ev.currentTarget) { closeTaskEditor(); }
    });
  /* v2.28.0: the description toolbar. A mousedown on a
     button is swallowed so the description editor's
     selection survives to the click; the click runs the
     matching command inside the description editor
     alone (runTaskDescCommand). */
  document.querySelectorAll("[data-task-desc-cmd]")
    .forEach(function (btn) {
      btn.addEventListener("mousedown", function (ev) {
        ev.preventDefault();
      });
      btn.addEventListener("click", function () {
        runTaskDescCommand(
          btn.getAttribute("data-task-desc-cmd"));
      });
    });
  /* v2.28.0: a paste into the description editor lands
     sanitized, never as raw clipboard HTML: the
     fragment passes the one sanitizer (styled spans
     becoming semantic marks on the way) and is inserted
     at the caret as nodes, with an append as the no
     caret fallback; plain text is the fallback when the
     clipboard carries no HTML at all. */
  document.getElementById("taskDescInput")
    .addEventListener("paste", function (ev) {
      ev.preventDefault();
      const el = document.getElementById("taskDescInput");
      const data = ev.clipboardData || window.clipboardData;
      if (!data || !data.getData) { return; }
      const frag = sanitizeTaskDescriptionHtml(
        data.getData("text/html") || "");
      let handled = false;
      if (frag) {
        handled = insertHtmlFragmentAtCaret(el, frag);
        if (!handled) {
          const holder = document.createElement("div");
          holder.innerHTML = frag;
          while (holder.firstChild) {
            el.appendChild(holder.firstChild);
          }
          handled = true;
        }
      } else {
        const plain = data.getData("text/plain") || "";
        if (plain) {
          handled = insertTextAtCaret(el, plain);
          if (!handled) {
            el.appendChild(document.createTextNode(plain));
            handled = true;
          }
        }
      }
      if (handled) { markTaskEditorDirty(); }
    });
  /* v2.28.0: typing in the description editor re-runs
     the @ token tracker, the popup's second host (the
     document selectionchange listener already covers
     caret moves in there). */
  document.getElementById("taskDescInput")
    .addEventListener("input", updateMentionPopup);
  /* v2.28.3: a click on a note link in the description
     follows it, exactly as a click in the note body does
     (through v2.28.2 this editor had no click handling
     for anchors at all, so its note links were inert
     text: no click of any kind followed them, modifier
     keys included). Modifier keys make no difference
     here either, again as in the body, whose note link
     branch runs ahead of its modified click branch. The
     one addition the modal owes its unsaved edits: when
     the target is a live note, the task is saved through
     saveTaskEditor first (which closes the editor), and
     only then does the link open the note, so following
     a link never throws away what was typed. When the
     target sits in Trash or Archive or is gone, nothing
     is saved, the editor stays open, and followNoteLink
     raises the same message it raises from a note. A
     click on anything that is not a note link returns
     untouched, caret and all. */
  document.getElementById("taskDescInput")
    .addEventListener("click", function (ev) {
      const target = ev.target;
      const anchor = (target && target.closest)
        ? target.closest("a") : null;
      if (!anchor) { return; }
      const ssNoteId = noteLinkIdOf(anchor);
      if (!ssNoteId) { return; }
      ev.preventDefault();
      /* Liveness is settled before any save: the same
         first test followNoteLink makes. */
      const live = state.notes.some(function (n) {
        return n.id === ssNoteId;
      });
      if (live && taskEditorState) { saveTaskEditor(); }
      followNoteLink(ssNoteId);
    });
  document.getElementById("taskModal").addEventListener("keydown",
    function (ev) {
      if (ev.key === "Escape") { closeTaskEditor(); }
    });
  ["taskTitleInput", "taskDescInput", "taskNotebookSelect",
   "taskNoteSelect", "taskDueDateInput", "taskDueTimeInput",
   "taskRecurrenceSelect", "taskPrioritySelect",
   "taskReminderSelect", "taskFlaggedInput"]
    .forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) { return; }
      el.addEventListener("input", markTaskEditorDirty);
      el.addEventListener("change", markTaskEditorDirty);
    });
  document.getElementById("taskDueDateInput")
    .addEventListener("change", syncTaskReminderControls);
  document.getElementById("taskReminderSelect")
    .addEventListener("change", syncTaskReminderControls);

  /* v2.24: the reminder scheduler's visibility look (a tab
     coming back to the front can owe a reminder), and the
     service worker's half of the notification click routing:
     the worker focuses this window and posts the task id, and
     the pending open machinery takes it from there. */
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      checkTaskReminders();
      /* v2.35: the note scheduler takes the same look. */
      checkNoteReminders();
    }
  });
  if ("serviceWorker" in navigator &&
      typeof navigator.serviceWorker.addEventListener ===
        "function") {
    navigator.serviceWorker.addEventListener("message",
      function (ev) {
        if (ev.data && ev.data.type === "snakescale-open-task") {
          queueTaskOpen(ev.data.taskId);
        }
        /* v2.35: the note reminder click's message, the
           task message's twin (see sw.js). */
        if (ev.data &&
            ev.data.type === "snakescale-open-note-reminder") {
          queueNoteReminderOpen(ev.data.noteReminderId);
        }
      });
  }

  /* v2.13: the Settings Getting started actions, and the first run
     walkthrough's controls. The walkthrough follows the Settings
     modal's close patterns: the primary button and Skip finish
     it (recording the seen flag), Back steps back, a click on
     the dimmed backdrop finishes it, and Escape finishes it. */
  document.getElementById("settingsWalkthroughBtn").addEventListener("click", function () {
    closeSettingsModal();
    openOnboarding(true);
  });
  document.getElementById("settingsStarterNoteBtn").addEventListener("click", function () {
    addStarterNoteFromSettings().catch(function (err) { toast(err.message, true); });
  });
  document.getElementById("onboardingNextBtn").addEventListener("click", onboardingNext);
  document.getElementById("onboardingBackBtn").addEventListener("click", onboardingBack);
  document.getElementById("onboardingSkipBtn").addEventListener("click", finishOnboarding);
  document.getElementById("onboardingModal").addEventListener("click", function (ev) {
    if (ev.target === ev.currentTarget) { finishOnboarding(); }
  });
  document.getElementById("onboardingModal").addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { finishOnboarding(); }
  });

  /* v2.8: the editor footer's History button and its modal, with
     the same close pattern as Settings. The list's Preview and
     Restore controls are wired per row in buildVersionHistoryRow. */
  document.getElementById("versionHistoryBtn").addEventListener("click", function () {
    openVersionHistory().catch(function (err) { toast(err.message, true); });
  });
  document.getElementById("versionHistoryCloseBtn").addEventListener("click", closeVersionHistory);
  document.getElementById("versionHistoryModal").addEventListener("click", function (ev) {
    if (ev.target === ev.currentTarget) { closeVersionHistory(); }
  });
  document.getElementById("versionHistoryModal").addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { closeVersionHistory(); }
  });

  /* v2.4: drag and drop notes between notebooks: the delegated
     pointerdown on the note list, the drop overlay's Cancel
     button, and the finished drag click suppression. */
  initNoteDragAndDrop();
  initNbNestDrag();
  initTagNestDrag();
  initNoteContextMenu();
  initNativeMenuSuppression();
  /* v2.82: the Email view's wiring, and the calendar
     day menu's. */
  initMailBindings();
  initCalDayMenus();

  /* Mobile bar. */
  document.getElementById("mobileNavBtn").addEventListener("click", function () { setMobileView("nav"); });
  document.getElementById("mobileListBtn").addEventListener("click", function () {
    /* v2.24.1: the Tasks view is its own pane now, no longer
       the list pane's content, so the Notes button leaves it
       for the notes list (All Notes), the way Back to list
       leaves the editor. Everywhere else it only switches
       panes, as always. */
    if (state.view.kind === "tasks") {
      state.view = { kind: "all", value: null };
      renderAll();
    }
    setMobileView("list");
  });
  document.getElementById("mobileNewBtn").addEventListener("click", function () {
    document.getElementById("newNoteBtn").click();
  });
  document.getElementById("editorBackBtn").addEventListener("click", function () { setMobileView("list"); });
  /* v2.56: breadcrumb navigation. One delegated listener
     on the bar itself, since renderBreadcrumb rebuilds
     its segments on every editor render; the segments
     are buttons carrying their destination, and the
     handler is the one navigation path (see
     handleBreadcrumbNav). Clicks on separators and on
     the current segment are not links and do nothing. */
  document.getElementById("noteBreadcrumb").addEventListener("click", function (ev) {
    const btn = ev.target && ev.target.closest ?
      ev.target.closest("[data-crumb-nav]") : null;
    if (!btn) { return; }
    handleBreadcrumbNav(btn.getAttribute("data-crumb-nav"),
      btn.getAttribute("data-crumb-slug"));
  });
  /* v2.56: the crumb's title segment follows the title
     field as it is typed, not only on the next render.
     (The field's dirty marking listener is wired with
     the other editor inputs below; this one only
     mirrors the text into the bar.) */
  document.getElementById("noteTitle").addEventListener("input", function () {
    const cur = document.getElementById("crumbCurrent");
    if (cur) { cur.textContent = breadcrumbTitleText(); }
  });
  /* v2.24.3: the Things to do page's footer carries the same
     phone affordance in its own footer. */
  document.getElementById("thingsBackBtn").addEventListener("click", function () { setMobileView("list"); });

  /* Editor inputs: any change marks the note dirty and autosaves.
     (v2.2: notePinned left this list with the checkbox itself; the
     pin flag is not a form field anymore. v2.5: noteNotebook left
     with the dropdown itself; the notebook is not a form field
     anymore either, it changes only through the move paths. The
     Tags input kept its place in this list from its new home in
     the editor footer.) */
  ["noteTitle", "noteTags"].forEach(function (id) {
    document.getElementById(id).addEventListener("input", markDirty);
    document.getElementById(id).addEventListener("change", markDirty);
  });

  /* v2.17: the Tags field picker. Focus or a click into the
     field opens it (a disabled field, which is every read only
     note, never does); typing re-filters it; a pick is taken on
     mousedown, before any blur can close the list, and the
     mousedown is swallowed so the field keeps focus and caret;
     a mousedown anywhere outside the picker and the field
     closes it, and Escape closes it from the capture phase so
     no other Escape handler also fires on the same press. */
  const noteTagsInput = document.getElementById("noteTags");
  noteTagsInput.addEventListener("focus", openTagPicker);
  noteTagsInput.addEventListener("click", openTagPicker);
  noteTagsInput.addEventListener("input", function () {
    if (tagPickerOpen()) { renderTagPicker(); }
  });
  document.getElementById("tagPicker").addEventListener("mousedown", function (ev) {
    ev.preventDefault();
    const target = ev.target;
    const rowEl = target && target.closest ?
      target.closest("[data-tag]") : null;
    if (rowEl) { pickTag(rowEl.getAttribute("data-tag")); }
  });
  /* The outside mousedown closer also recognizes a picked row
     by its own class: pickTag's re-render detaches the row that
     was pressed before this listener sees the event bubble up,
     so its #tagPicker ancestor no longer resolves and a plain
     ancestor check would close the picker the pick just
     refreshed. */
  document.addEventListener("mousedown", function (ev) {
    if (!tagPickerOpen()) { return; }
    const target = ev.target;
    if (!target || !target.closest) { return; }
    if (target.closest("#tagPicker") ||
        target.closest(".tag-picker-row") ||
        target === noteTagsInput) { return; }
    closeTagPicker();
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape" || !tagPickerOpen()) { return; }
    closeTagPicker();
    ev.preventDefault();
    ev.stopPropagation();
  }, true);

  /* v2.5: the notebook link and its menu. The link toggles the
     menu; a click anywhere outside the wrap closes it, and so
     does Escape (each in the same style as the export menu's
     closers above). Choosing an item runs moveNoteToNotebook
     from the item's own listener (see openNotebookMenu). */
  document.getElementById("notebookLink").addEventListener("click", function (ev) {
    ev.stopPropagation();
    toggleNotebookMenu();
  });
  document.getElementById("notebookMenu").addEventListener("click", function (ev) {
    ev.stopPropagation();
  });
  document.addEventListener("click", function (ev) {
    const menu = document.getElementById("notebookMenu");
    if (!menu || menu.classList.contains("hidden")) { return; }
    const target = ev.target;
    if (target && target.closest && target.closest(".notebook-link-wrap")) { return; }
    closeNotebookMenu();
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { closeNotebookMenu(); }
  });

  /* v2.5: Maximize. The button toggles; Escape leaves too, but
     only when no menu, panel, popup, modal, or note drag is up.
     Those all have their own Escape closers, most of them bubble
     phase document handlers like this one, so by the time a
     bubble handler runs the menu it should defer to is already
     closed and gone. The capture phase listener therefore
     snapshots anyOverlayOpen BEFORE any closer runs, and the
     bubble handler acts on the snapshot: Escape with something
     open closes that thing (its own handlers do it) and leaves
     maximize alone; only a bare Escape exits maximize. The one
     capture phase closer, the note drag's, is covered too: an
     active drag makes the snapshot true on its own. */
  let maximizeEscapeHadOverlay = false;
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { maximizeEscapeHadOverlay = anyOverlayOpen(); }
  }, true);
  document.getElementById("maximizeBtn").addEventListener("click", function () {
    setMaximized(!editorMaximized);
  });
  setMaximized(false);
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape" || !editorMaximized) { return; }
    if (maximizeEscapeHadOverlay) { return; }
    setMaximized(false);
  });

  /* v2.5: the icon rail. Most rail leaf buttons click their full
     sidebar counterparts, so each action keeps exactly one
     implementation. v2.7: three of those counterparts were the
     sidebar footer menu's items (the sign out item, and the
     collapse item the rail's expand button clicks); clicking a
     hidden menu item runs its handler exactly as a visible click
     would. v2.8: Refresh connection and Dark mode no longer have
     menu items to click through to (both live in Settings now),
     so the rail's refresh and theme buttons call the shared
     functions directly: refreshGoogleConnection for refresh,
     and toggleTheme for the theme. The Notebooks button opens
     the flyout on hover or click; leaving the button or the
     flyout starts the grace close (scheduleRailFlyoutClose), and
     the flyout's New Notebook entry clicks the sidebar's add
     button, then closes. v2.18: the expand button leaves the
     click through list: its old counterpart, the footer's
     Collapse sidebar menu item, is gone, and the button now
     runs setSidebarRail directly, the same single toggle the
     new footer collapse button runs. */
  [["railNewNoteBtn", "newNoteBtn"],
   ["railEmailBtn", "navEmail"], ["railAllBtn", "navAll"],
   ["railCalendarBtn", "navCalendar"],
   ["railPinnedBtn", "navPinned"], ["railRemindersBtn", "navReminders"], ["railTrashBtn", "navTrash"],
   ["railArchiveBtn", "navArchive"], ["railLockBtn", "sidebarSignOutItem"]
   ].forEach(function (pair) {
    document.getElementById(pair[0]).addEventListener("click", function () {
      document.getElementById(pair[1]).click();
    });
  });
  document.getElementById("railExpandBtn").addEventListener("click", function () {
    setSidebarRail(false);
  });
  document.getElementById("railRefreshBtn").addEventListener("click", function () {
    refreshGoogleConnection().catch(function (err) { toast(err.message, true); });
  });
  document.getElementById("railThemeBtn").addEventListener("click", function () {
    toggleTheme();
  });
  const railNbBtn = document.getElementById("railNotebooksBtn");
  const railFlyout = document.getElementById("railFlyout");
  railNbBtn.addEventListener("pointerenter", function () { openRailFlyout(); });
  railNbBtn.addEventListener("pointerleave", function () { scheduleRailFlyoutClose(); });
  railNbBtn.addEventListener("click", function () { toggleRailFlyout(); });
  railFlyout.addEventListener("pointerenter", function () { openRailFlyout(); });
  railFlyout.addEventListener("pointerleave", function () { scheduleRailFlyoutClose(); });
  document.getElementById("railNewNotebookBtn").addEventListener("click", function () {
    closeRailFlyout();
    document.getElementById("addNotebookBtn").click();
  });
  document.getElementById("noteBody").addEventListener("input", markDirty);
  /* v1.7: the same body input events feed the attachment deletion
     reconciliation, which notices blocks removed with the Delete or
     Backspace keys. A separate listener; the markDirty one above is
     untouched. */
  document.getElementById("noteBody").addEventListener("input", function () {
    queueAttachmentBodyCheck();
  });
  /* v2.99.0: the same body input events keep the
     code block at the caret's caret furniture true
     (see syncCodeCaretBr): a native edit that fills
     a block's empty last line retires its furniture
     break, one that empties the line back to a
     trailing newline restores it, and the plain
     break a native Backspace leaves standing as
     the line holder is adopted. A separate
     listener; the ones above and below are
     untouched. */
  document.getElementById("noteBody").addEventListener("input", function () {
    const pre = codeBlockAtSelection();
    if (pre) { syncCodeCaretBr(pre); }
  });
  /* v2.85: the tag pill deletion watch: a deletion
     gesture's beforeinput snapshots the body's pill
     counts, and the input event that follows every
     body edit reconciles them (a tag whose last pill
     fell leaves the note). Separate listeners; the
     ones above are untouched. */
  document.getElementById("noteBody").addEventListener("beforeinput",
    captureTagPillsBeforeDelete);
  document.getElementById("noteBody").addEventListener("input",
    reconcileTagPillsAfterDelete);
  /* v2.37.0: the same body input events feed the table of
     contents refresh, through its own debounce, so heading
     edits made by typing, paste, the style dropdown, undo,
     or redo repaint the blocks once they settle. A separate
     listener; the ones above are untouched. */
  document.getElementById("noteBody").addEventListener("input", function () {
    queueTocRefresh();
  });
  /* v2.49.0: the same body input events feed the note
     tasks blocks' refresh, through its own debounce, so
     an undo, a redo, or a paste that changes what a
     block should show repaints it once the events
     settle. A separate listener; the ones around it are
     untouched, and the block's own control events never
     reach it (the block's guard stops them first). */
  document.getElementById("noteBody").addEventListener("input", function () {
    queueNoteTasksRefresh();
  });
  /* v2.48.0: the same body events feed collapsible
     sections, through separate listeners, the ones above
     and below untouched: input events rederive the
     toggles and folds once they settle; a press on a fold
     toggle is kept from moving the caret, so the click
     that follows folds without disturbing any selection;
     the click itself folds or unfolds through the one
     toggle path; and keydown runs the fold boundary
     guards, which only ever unfold before a key acts. */
  document.getElementById("noteBody").addEventListener("input", function () {
    queueSectionFoldRefresh();
  });
  document.getElementById("noteBody").addEventListener("mousedown", function (ev) {
    if (ev.target && ev.target.closest &&
        ev.target.closest(".ss-fold-toggle")) {
      ev.preventDefault();
    }
  });
  document.getElementById("noteBody").addEventListener("click", function (ev) {
    const btn = ev.target && ev.target.closest
      ? ev.target.closest(".ss-fold-toggle") : null;
    if (btn && btn.parentNode) { toggleSectionFold(btn.parentNode); }
  });
  document.getElementById("noteBody").addEventListener("keydown",
    onSectionFoldKeydown);

  /* v2.14: voice note wiring. The toolbar button starts a
     recording (the toolbar's mousedown backstop has already saved
     the selection by the time the click lands, and startVoiceNote
     saves it again before the microphone prompt), Stop and Cancel
     live on the bar, and Escape while recording means Cancel. The
     bar is in anyOverlayOpen's set, so that Escape is spent on the
     recording and never also exits Maximize. */
  document.getElementById("voiceNoteBtn").addEventListener("click", function () {
    startVoiceNote().catch(function (err) { toast(err.message, true); });
  });
  wireVoiceBarButton("voiceStopBtn", function () {
    stopVoiceNote().catch(function (err) { toast(err.message, true); });
  });
  wireVoiceBarButton("voiceCancelBtn", function () {
    cancelVoiceNote();
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && voiceCapture) { cancelVoiceNote(); }
  });

  /* v2.14: block grip wiring. Pointer movement over the editor
     tracks the block under the pointer; movement anywhere outside
     the editor, or a scroll of the editor, hides the grip; a press
     on the grip itself starts the drag. v2.14.2: the tracker is
     bound to .editor-scroll, not .editor-inner. The grip renders
     left of the column, over .editor-scroll, so movements on the
     reach to grab it target .editor-scroll and their event path
     never passes through .editor-inner at all: bound there, the
     tracker never saw the crossing, and the outside guard below
     (then scoped to .editor-inner) hid the grip instead. Both the
     tracker and the guard are scoped to .editor-scroll now, the
     container every target in the reach actually lives in. */
  document.querySelector(".editor-scroll").addEventListener("pointermove",
    onGripHoverPointerMove);
  document.addEventListener("pointermove", function (ev) {
    const scroll = document.querySelector(".editor-scroll");
    if (scroll && ev.target && !scroll.contains(ev.target)) {
      hideBlockGrip();
    }
  });
  document.querySelector(".editor-scroll").addEventListener("scroll",
    function () { hideBlockGrip(); });
  document.getElementById("blockGrip").addEventListener("pointerdown",
    onGripPointerDown);

  /* v2.12: the "@" note popup wiring. Typing in the body and every
     selection change re-run the token tracker; the keys are taken
     on the document's capture phase (see onMentionPopupKeydown),
     so an open popup consumes Enter, Tab, and the arrows before
     the body's own keydown handlers run; scrolling the editor
     closes it, like the link bar and the image menu, since its
     fixed position belongs to the caret line it opened under; a
     click anywhere outside the popup and the body closes it too
     (a click inside the body is the tracker's business: it moves
     the caret, and the selection change re-evaluates the token).
     The popup's own mousedown is swallowed so clicking a row
     never moves the editor selection before the click lands. */
  document.getElementById("noteBody").addEventListener("input",
    updateMentionPopup);
  document.addEventListener("selectionchange", updateMentionPopup);
  document.addEventListener("keydown", onMentionPopupKeydown, true);
  /* v2.105.0: the Scratch Pad's selection bank and its
     toolbar's active faces ride the same document
     selectionchange the popups track on (both helpers
     stand down when the selection is not the pad's). */
  document.addEventListener("selectionchange", function () {
    saveScratchSelection();
    syncScratchToolbar();
  });
  document.querySelector(".editor-scroll").addEventListener("scroll",
    function () { closeMentionPopup(); });

  /* v2.83: the "^" event picker and the "#" tag picker
     take the mention popup's wiring: the same input and
     selection trackers, capture phase keys, the scroll
     close, and the outside click close. Their mousedown
     is swallowed so a row click never moves the editor
     selection before the click lands; the event
     picker's search box and its Include past events
     checkbox keep their mousedown, like the mention
     search box does. */
  document.getElementById("noteBody").addEventListener("input",
    updateEventLinkPopup);
  document.getElementById("noteBody").addEventListener("input",
    updateTagLinkPopup);
  document.addEventListener("selectionchange",
    updateEventLinkPopup);
  document.addEventListener("selectionchange",
    updateTagLinkPopup);
  document.addEventListener("keydown",
    onEventLinkPopupKeydown, true);
  document.addEventListener("keydown",
    onTagLinkPopupKeydown, true);
  document.querySelector(".editor-scroll").addEventListener("scroll",
    function () { closeEventLinkPopup(); closeTagLinkPopup(); });
  document.addEventListener("click", function (ev) {
    const target = ev.target;
    if (!target || !target.closest) { return; }
    if (eventLinkPopupOpen() &&
        !target.closest("#eventLinkPopup") &&
        !target.closest("#noteBody") &&
        !target.closest("#homeScratchText") &&
        !target.closest("#homeScratchToolbar")) {
      closeEventLinkPopup();
    }
    if (tagLinkPopupOpen() &&
        !target.closest("#tagLinkPopup") &&
        !target.closest("#noteBody") &&
        !target.closest("#homeScratchText") &&
        !target.closest("#homeScratchToolbar")) {
      closeTagLinkPopup();
    }
  });
  const eventLinkPopupEl = document.getElementById("eventLinkPopup");
  eventLinkPopupEl.addEventListener("mousedown", function (ev) {
    const t = ev.target;
    if (t && t.closest && t.closest(
      ".mention-search, .event-link-past")) { return; }
    ev.preventDefault();
  });
  eventLinkPopupEl.addEventListener("click", function (ev) {
    const target = ev.target;
    const rowEl = target && target.closest ?
      target.closest("[data-ei]") : null;
    if (rowEl) {
      pickEventLinkRow(Number(rowEl.getAttribute("data-ei")));
    }
  });
  eventLinkPopupEl.addEventListener("mouseover", function (ev) {
    const target = ev.target;
    const rowEl = target && target.closest ?
      target.closest("[data-ei]") : null;
    if (rowEl) {
      setEventLinkHighlight(Number(rowEl.getAttribute("data-ei")));
    }
  });
  const tagLinkPopupEl = document.getElementById("tagLinkPopup");
  tagLinkPopupEl.addEventListener("mousedown", function (ev) {
    ev.preventDefault();
  });
  tagLinkPopupEl.addEventListener("click", function (ev) {
    const target = ev.target;
    const rowEl = target && target.closest ?
      target.closest("[data-ti]") : null;
    if (rowEl) {
      pickTagLinkRow(Number(rowEl.getAttribute("data-ti")));
    }
  });
  tagLinkPopupEl.addEventListener("mouseover", function (ev) {
    const target = ev.target;
    const rowEl = target && target.closest ?
      target.closest("[data-ti]") : null;
    if (rowEl) {
      setTagLinkHighlight(Number(rowEl.getAttribute("data-ti")));
    }
  });
  document.addEventListener("click", function (ev) {
    if (!mentionPopupOpen()) { return; }
    const target = ev.target;
    if (!target || !target.closest) { return; }
    if (target.closest("#mentionPopup") ||
        target.closest("#noteBody") ||
        target.closest("#taskDescInput") ||
        target.closest("#homeScratchText") ||
        target.closest("#homeScratchToolbar")) { return; }
    closeMentionPopup();
  });
  const mentionPopupEl = document.getElementById("mentionPopup");
  mentionPopupEl.addEventListener("mousedown", function (ev) {
    /* v2.17: the search box must be allowed to take focus, so a
       mousedown on it is not swallowed; every other mousedown in
       the popup still is, so clicking a row never moves the
       editor selection before the click lands. */
    const t = ev.target;
    if (t && t.closest && t.closest(".mention-search")) { return; }
    ev.preventDefault();
  });
  mentionPopupEl.addEventListener("click", function (ev) {
    const target = ev.target;
    const rowEl = target && target.closest ?
      target.closest("[data-mi]") : null;
    if (rowEl) { pickMentionRow(Number(rowEl.getAttribute("data-mi"))); }
  });
  mentionPopupEl.addEventListener("mouseover", function (ev) {
    const target = ev.target;
    const rowEl = target && target.closest ?
      target.closest("[data-mi]") : null;
    if (rowEl) {
      setMentionHighlight(Number(rowEl.getAttribute("data-mi")));
    }
  });

  /* v2.23: the Paste options popup wiring, mirroring the
     mention popup's. The popup's mousedown is swallowed whole
     (it holds no input), so clicking a row never moves the
     editor selection before the click lands; the click then
     swaps the paste's mode, or opens Settings at the Default
     paste select from the footer row. Dismissal: Escape
     (taken on the capture phase, so it works while the editor
     holds focus and never falls through to the maximize
     handler), any keystroke aimed at the editor (the caret is
     moving to a new edit; the keystroke itself proceeds, Word
     parity), the input event of the first real edit after
     the paste (the paste's own input event is excused by the
     session's fresh mark, and a switch's programmatic insert
     by the applying flag), a mousedown anywhere outside the
     popup, an editor scroll, and any note switch (renderEditor
     closes it). */
  const pastePopupEl = document.getElementById("pastePopup");
  pastePopupEl.addEventListener("mousedown", function (ev) {
    ev.preventDefault();
  });
  pastePopupEl.addEventListener("click", function (ev) {
    const target = ev.target;
    if (!target || !target.closest) { return; }
    const modeRow = target.closest("[data-paste-mode]");
    if (modeRow) {
      applyPasteMode(modeRow.getAttribute("data-paste-mode"));
      return;
    }
    const actionRow = target.closest("[data-paste-action]");
    if (actionRow &&
        actionRow.getAttribute("data-paste-action") === "set-default") {
      openSettingsAtDefaultPaste();
    }
  });
  document.addEventListener("keydown", function (ev) {
    if (!pastePopupOpen()) { return; }
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closePastePopup();
      return;
    }
    const target = ev.target;
    if (target && target.closest &&
        target.closest("#pastePopup")) { return; }
    if (target && target.closest &&
        target.closest("#noteBody")) {
      closePastePopup();
    }
  }, true);
  document.getElementById("noteBody").addEventListener("input",
    function () {
      if (!pastePopupOpen() || pastePopupApplying) { return; }
      if (pastePopupSession && pastePopupSession.fresh) {
        /* The input event of the paste itself: the session
           stays. The mark is spent, so the NEXT input event
           is the user's first edit after the paste and
           dismisses like any other. */
        delete pastePopupSession.fresh;
        return;
      }
      closePastePopup();
    });
  document.querySelector(".editor-scroll").addEventListener("scroll",
    function () { closePastePopup(); });
  document.addEventListener("mousedown", function (ev) {
    if (!pastePopupOpen()) { return; }
    const target = ev.target;
    if (target && target.closest && target.closest("#pastePopup")) {
      return;
    }
    closePastePopup();
  });

  /* Checklist toggling: a click on a checkbox inside the body flips the
     done style on its list item and saves. The change event from the
     checkbox also bubbles as an input event in most browsers, so the
     dirty marking here is a belt and suspenders second call.
     v2.7: the click is mirrored into the box's serialized form in
     the same breath (syncChecklistBox): the class alone used to be
     saved, so the strikethrough persisted while the box itself
     came back unchecked on the next open. */
  document.getElementById("noteBody").addEventListener("click", function (ev) {
    const target = ev.target;
    if (target && target.tagName === "INPUT" && target.type === "checkbox") {
      const li = target.closest("li");
      if (li) {
        li.classList.toggle("done", target.checked);
        syncChecklistBox(target);
        /* v2.101.0 (audit D4): the click focuses the
           box itself, which strands the editor
           selection outside the text: keystrokes
           after checking an item off went nowhere
           until the user clicked back in. For a
           checklist item, the caret goes back into
           the item's own text, at its end, so typing
           simply continues. */
        const list = li.parentElement;
        if (isChecklistList(list)) {
          const bodyEl = document.getElementById("noteBody");
          if (bodyEl) {
            /* v2.109.0: the refocus must not move the
               reader's place. The bare focus() above
               scrolled the editor toward the selection
               that stood before the click (the caret is
               often parked far from the box being
               checked, for example at the top of a long
               note), and parking the caret in the item
               afterward never scrolled back, so the
               note appeared to jump to a different spot
               whenever a box was checked from a distance
               (Chris's report). The scroll is captured
               first, the focus is asked not to scroll,
               and any movement the browser still makes
               is undone, so the item stays exactly
               where it stood on screen while the D2
               caret guarantee above it is untouched. */
            const scroller = document.querySelector(
              ".editor-scroll");
            const keepTop = scroller ?
              scroller.scrollTop : null;
            const keepLeft = scroller ?
              scroller.scrollLeft : null;
            bodyEl.focus({ preventScroll: true });
            placeCaretAtItemTextOffset(li,
              itemOwnTextLength(li));
            if (scroller && keepTop !== null &&
                (scroller.scrollTop !== keepTop ||
                 scroller.scrollLeft !== keepLeft)) {
              scroller.scrollTop = keepTop;
              scroller.scrollLeft = keepLeft;
            }
          }
        }
        markDirty();
      }
    }
  });

  /* v1.3.1 link behavior, a SEPARATE listener so the checkbox handler
     above is untouched. Ctrl+click or Cmd+click opens the link in a new
     tab (preventDefault stops the browser from also trying to follow or
     select). A plain click is NOT prevented: the caret still lands in
     the link text for editing exactly as before, and the link bar
     appears alongside as the way to open it (and the only way on touch
     screens). Clicking a non link part of the body hides the bar.
     v2.1.0: note links (href "ssnote:<id>") are resolved FIRST, before
     both the modified click branch and the bar branch below: any
     click on one navigates inside the app (see followNoteLink), and
     the web link bar never appears for them.
     v2.9: the bar replaced the popup in the plain click branch, and
     anchors the bar does not serve (attachment furniture, links in a
     locked note) simply hide it instead of summoning it.
     v2.10: the note link branch above is unchanged in behavior
     (a click still opens the target at once, in every display
     mode, and hideLinkBar puts away the bar AND the Mention
     card, since it is the one central hide); what changed is
     only that the bar now also serves note links on hover,
     through the mouseover listener below. */
  document.getElementById("noteBody").addEventListener("click", function (ev) {
    const target = ev.target;
    /* v2.83: an event chip and a tag pill resolve here,
       ahead of the anchor branches: a chip travels to
       its event, a pill opens the tag's list, and
       neither ever summons the link bar. */
    const evChip = (target && target.closest)
      ? target.closest(".ss-event-chip") : null;
    if (evChip) {
      ev.preventDefault();
      hideLinkBar();
      followEventChip(evChip);
      return;
    }
    const tagPill = (target && target.closest)
      ? target.closest(".ss-tag-pill") : null;
    if (tagPill) {
      ev.preventDefault();
      hideLinkBar();
      openTagFilter(tagPill.getAttribute("data-ss-tag") || "");
      return;
    }
    /* v2.84: an email chip resolves here too: it
       travels to its message in the Email view. */
    const mailChip = (target && target.closest)
      ? target.closest(".ss-mail-chip") : null;
    if (mailChip) {
      ev.preventDefault();
      hideLinkBar();
      followMailChip(mailChip);
      return;
    }
    const anchor = (target && target.closest) ? target.closest("a") : null;
    if (!anchor) {
      hideLinkBar();
      return;
    }
    /* v2.37.0: a table of contents entry resolves here,
       ahead of every other branch: its href is an in page
       fragment, and anchor.href resolves it absolute, so
       the generic branches would treat it as a web link
       and open the app itself in a new tab. A TOC click is
       only ever a jump to the heading inside this note. */
    if (anchor.closest && anchor.closest(".ss-toc")) {
      ev.preventDefault();
      hideLinkBar();
      scrollToTocHeading(anchor.getAttribute("data-ss-toc-target"));
      return;
    }
    const ssNoteId = noteLinkIdOf(anchor);
    if (ssNoteId) {
      ev.preventDefault();
      hideLinkBar();
      followNoteLink(ssNoteId);
      return;
    }
    /* v2.28.0: task links resolve here too, beside the
       note links and ahead of every generic branch: any
       click opens the task's editor over the note, and
       the web link bar never appears for them. */
    const ssTaskId = taskLinkIdOf(anchor);
    if (ssTaskId) {
      ev.preventDefault();
      hideLinkBar();
      followTaskLink(ssTaskId);
      return;
    }
    if (ev.ctrlKey || ev.metaKey) {
      ev.preventDefault();
      hideLinkBar();
      openNoteLink(anchor.href || anchor.getAttribute("href") || "");
    } else if (linkBarAnchorFor(anchor)) {
      showLinkBar(anchor);
    } else {
      hideLinkBar();
    }
  });

  /* v2.9: hover summons the bar too. Resting the mouse on an
     external link starts the show delay; leaving the link starts
     the grace hide, and entering the bar cancels it, so the pointer
     can cross from the link up into the bar without the bar
     flickering shut. Moving directly between two links retargets
     the bar at once (scheduleLinkBarShow handles that case). The
     listeners live on the body and resolve the anchor from the
     event target, so links created after wiring are covered.
     v2.10: note links are served here too, with one routing
     rule: a note link shown as a Mention whose target still
     exists schedules its hover CARD, not the bar. Every other
     served link, note links in Text, Title, and Preview modes
     included, schedules the bar. */
  document.getElementById("noteBody").addEventListener("mouseover", function (ev) {
    const target = ev.target;
    const anchor = (target && target.closest) ? target.closest("a") : null;
    const served = anchor ? linkBarAnchorFor(anchor) : null;
    if (!served) { return; }
    const servedNoteId = noteLinkIdOf(served);
    if (servedNoteId && linkViewModeOf(served) === "mention" &&
        findNoteById(servedNoteId)) {
      scheduleNoteLinkCardShow(served);
      return;
    }
    scheduleLinkBarShow(served);
  });
  document.getElementById("noteBody").addEventListener("mouseout", function (ev) {
    const target = ev.target;
    const anchor = (target && target.closest) ? target.closest("a") : null;
    if (!anchor) { return; }
    const related = ev.relatedTarget;
    /* Still inside the same anchor, or stepping into the bar,
       its menu, or the Mention card: none of those count as
       leaving. (The menu is the bar's sibling since v2.10, so
       it needs its own line here.) */
    if (related && related.closest) {
      if (related.closest("a") === anchor) { return; }
      if (related.closest("#linkBar")) { return; }
      if (related.closest("#linkViewMenu")) { return; }
      if (related.closest("#noteLinkCard")) { return; }
    }
    if (linkBarHoverAnchor === anchor) { linkBarHoverAnchor = null; }
    if (noteLinkCardHoverAnchor === anchor) {
      noteLinkCardHoverAnchor = null;
    }
    if (linkBarAnchor === anchor || linkBarVisible()) {
      scheduleLinkBarHide();
    }
  });
  document.getElementById("linkBar").addEventListener("mouseenter", function () {
    cancelLinkBarHide();
    if (linkBarShowTimer) { clearTimeout(linkBarShowTimer); linkBarShowTimer = null; }
  });
  document.getElementById("linkBar").addEventListener("mouseleave", function (ev) {
    const related = ev.relatedTarget;
    /* Stepping back onto the link the bar belongs to keeps it up;
       the body's own mouseover for that anchor also re-arms it. */
    if (related && related.closest &&
        linkBarAnchor && related.closest("a") === linkBarAnchor) { return; }
    scheduleLinkBarHide();
  });

  /* v2.10: the View Link As menu is the bar's sibling now, so it
     keeps the hover discipline with its own pair: entering it
     cancels a pending hide (crossing from the bar or the card
     down into the menu never flickers anything shut), and
     leaving it starts the grace hide, exactly like leaving the
     bar. The Mention card gets the same pair, mirrored: its
     mouseleave steps back onto its mention without hiding. */
  document.getElementById("linkViewMenu").addEventListener("mouseenter", function () {
    cancelLinkBarHide();
  });
  document.getElementById("linkViewMenu").addEventListener("mouseleave", function () {
    scheduleLinkBarHide();
  });
  document.getElementById("noteLinkCard").addEventListener("mouseenter", function () {
    cancelLinkBarHide();
    if (noteLinkCardShowTimer) {
      clearTimeout(noteLinkCardShowTimer);
      noteLinkCardShowTimer = null;
    }
  });
  document.getElementById("noteLinkCard").addEventListener("mouseleave", function (ev) {
    const related = ev.relatedTarget;
    if (related && related.closest &&
        noteLinkCardAnchor &&
        related.closest("a") === noteLinkCardAnchor) { return; }
    scheduleLinkBarHide();
  });

  /* Link bar controls (v1.3.1, reworked in v1.3.2, rebuilt as the
     bar in v2.9). All of them live outside #noteBody, so these clicks
     can never edit the note or mark it dirty by themselves; only a
     successful edit Save, a mode switch, an unlink, a delete, or a
     landed info fetch marks dirty.
     The address itself is the open control. Its default anchor
     navigation is prevented and the click is routed through
     openNoteLink with the href captured when the bar was shown, so
     the protocol safety check applies exactly as it does to
     Ctrl+click, and the bar closes first. */
  document.getElementById("linkBarUrl").addEventListener("click", function (ev) {
    ev.preventDefault();
    /* v2.10: for a note link the label is the target's title
       button: it opens the target through the same navigation
       a body click runs (followNoteLink owns the Trash and
       Archive answers), and does nothing at all when the
       target is gone from every list. */
    const anchor = linkBarAnchor;
    const noteId = anchor ? noteLinkIdOf(anchor) : null;
    const href = linkBarHref;
    hideLinkBar();
    if (noteId) {
      if (findNoteById(noteId)) { followNoteLink(noteId); }
      return;
    }
    if (href) { openNoteLink(href); }
  });
  /* The pencil swaps the bar to its inline edit form. */
  document.getElementById("linkBarEditBtn").addEventListener("click", function () {
    startLinkEdit();
  });
  /* Copy and the menu's Copy URL are the one copy action.
     v2.10: the action dispatches by link kind (an address for
     a web link, the note link itself for a note link), and
     the Mention card's Copy Link button runs the note copy
     against the card's mention directly. */
  document.getElementById("linkBarCopyBtn").addEventListener("click", function () {
    copyLinkBarLink();
  });
  document.getElementById("linkViewCopyBtn").addEventListener("click", function () {
    copyLinkBarLink();
  });
  document.getElementById("noteLinkCardCopyBtn").addEventListener("click", function () {
    if (noteLinkCardAnchor) { copyNoteLink(noteLinkCardAnchor); }
  });
  /* The card's three dot button opens the same View Link As
     menu (positioned under the card by openLinkViewMenu). */
  document.getElementById("noteLinkCardMenuBtn").addEventListener("click", function () {
    toggleLinkViewMenu();
  });
  /* The note link edit state's Change note button reopens the
     picker as a retarget picker for the bar's link. */
  document.getElementById("linkEditChangeNoteBtn").addEventListener("click", function () {
    openNoteLinkRetargetPicker();
  });
  /* The broken link button unlinks: text stays, link goes. */
  document.getElementById("linkBarUnlinkBtn").addEventListener("click", function () {
    unlinkLinkBarAnchor();
  });
  /* The three dot button toggles the View Link As menu. */
  document.getElementById("linkBarMenuBtn").addEventListener("click", function () {
    toggleLinkViewMenu();
  });
  /* The menu's mode rows carry data-link-view; one delegated
     listener runs the switch against the bar's link. */
  document.getElementById("linkViewMenu").addEventListener("click", function (ev) {
    const target = ev.target;
    const item = target && target.closest ?
      target.closest("[data-link-view]") : null;
    if (item) { setLinkViewMode(item.getAttribute("data-link-view")); }
  });
  /* The menu's Delete removes the link and its text together. */
  document.getElementById("linkViewDeleteBtn").addEventListener("click", function () {
    deleteLinkBarAnchor();
  });
  /* Save applies the form (normalizing and validating the address);
     saveLinkEdit itself keeps the form open on an invalid address. */
  document.getElementById("linkEditSave").addEventListener("click", function () {
    saveLinkEdit();
  });
  /* Cancel throws the form away and returns to the normal view without
     changing the link, then repositions since the bar shrinks back. */
  document.getElementById("linkEditCancel").addEventListener("click", function () {
    setLinkBarMode(false);
    if (linkBarAnchor) { positionLinkBar(linkBarAnchor); }
  });

  /* v1.3.1: clicking anywhere else in the app closes the popup.
     v2.9: same rule for the bar and its menu (one rule covers both,
     since the menu lives inside the bar element). Clicks inside the
     bar itself, and clicks on body links (handled by the listener
     above, which repositions or reopens it), are excluded. This is
     also what closes the bar when another overlay or modal opens:
     those all open from clicks outside the bar.
     v2.10: the menu is the bar's sibling now, and the Mention
     card can be the only surface up, so the guard passes when
     either surface is visible, and the exclusions name the menu
     and the card separately. The note link picker is excluded
     as a whole: while the modal is open no bar can be summoned
     (the modal covers the note), and the one bar that can exist
     during a picker click is the retarget bar, which a row
     click has JUST shown for the retargeted link; closing it
     again in the same click would undo the retarget's landing.
     (The insert flow never has a bar behind its picker, so the
     exclusion changes nothing there.) */
  document.addEventListener("click", function (ev) {
    const bar = document.getElementById("linkBar");
    if ((!bar || bar.classList.contains("hidden")) &&
        !noteLinkCardVisible()) { return; }
    const target = ev.target;
    if (!target || !target.closest) { return; }
    if (target.closest("#linkBar")) { return; }
    if (target.closest("#linkViewMenu")) { return; }
    if (target.closest("#noteLinkCard")) { return; }
    if (target.closest("#noteLinkModal")) { return; }
    const anchor = target.closest("a");
    if (anchor && document.getElementById("noteBody").contains(anchor)) { return; }
    hideLinkBar();
  });

  /* v1.7: the image menu's items run through one delegated listener;
     the menu remembers which attachment it was opened from. */
  document.getElementById("attMenu").addEventListener("click", function (ev) {
    const target = ev.target;
    const btn = target && target.closest ?
      target.closest("button[data-action]") : null;
    if (!btn) { return; }
    runAttMenuAction(btn.getAttribute("data-action"));
  });

  /* v1.7: clicking anywhere else closes the image menu, mirroring
     the link popup's rule. Clicks inside the menu itself, and on a
     menu button (which toggles the menu for its own image), are
     excluded. v2.11: the alignment submenu is part of the menu for
     this rule; its clicks are excluded the same way. */
  document.addEventListener("click", function (ev) {
    const menu = document.getElementById("attMenu");
    if (!menu || menu.classList.contains("hidden")) { return; }
    const target = ev.target;
    if (!target || !target.closest) { return; }
    if (target.closest("#attMenu")) { return; }
    if (target.closest("#attAlignMenu")) { return; }
    if (target.closest(".ss-att-menu-btn")) { return; }
    closeAttMenu();
  });

  /* v2.11: the alignment submenu's items run through one delegated
     listener, like the menu's own. */
  document.getElementById("attAlignMenu").addEventListener("click", function (ev) {
    const target = ev.target;
    const btn = target && target.closest ?
      target.closest("button[data-align]") : null;
    if (!btn) { return; }
    runAttAlignChoice(btn.getAttribute("data-align"));
  });

  /* v2.14.1: the audio card menu's items run through one delegated
     listener, like the image menu's; a disabled item (the read
     only note state) never runs. */
  document.getElementById("attCardMenu").addEventListener("click", function (ev) {
    const target = ev.target;
    const btn = target && target.closest ?
      target.closest("button[data-card-action]") : null;
    if (!btn || btn.disabled) { return; }
    runAttCardMenuAction(btn.getAttribute("data-card-action"));
  });

  /* v2.14.1: clicking anywhere else closes the card menu,
     mirroring the image menu's rule. Clicks inside the menu
     itself, and on a card's menu button (which toggles the menu
     for its own card), are excluded. */
  document.addEventListener("click", function (ev) {
    const menu = document.getElementById("attCardMenu");
    if (!menu || menu.classList.contains("hidden")) { return; }
    const target = ev.target;
    if (!target || !target.closest) { return; }
    if (target.closest("#attCardMenu")) { return; }
    if (target.closest(".ss-card-menu-btn")) { return; }
    closeAttCardMenu();
  });

  /* v2.14.1: Escape closes the card menu as well, like the
     image menu. */
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { closeAttCardMenu(); }
  });

  /* v2.11: Escape discipline for the image surfaces, innermost
     first: the editor and the lightbox are modal and close (the
     editor discards, exactly like its Cancel), and the alignment
     submenu closes before the menu it hangs off. stopImmediate-
     Propagation keeps the later generic handlers (menu close,
     deselect) from ALSO acting on the same keypress; the Maximize
     capture handler already counted these as open overlays
     through anyOverlayOpen, so Maximize stays put either way. */
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") { return; }
    if (imageEditorOpen()) {
      closeImageEditor();
      ev.stopImmediatePropagation();
      return;
    }
    if (imageLightboxOpen()) {
      closeImageLightbox();
      ev.stopImmediatePropagation();
      return;
    }
    if (attAlignMenuOpen()) {
      closeAttAlignMenu();
      ev.stopImmediatePropagation();
    }
  });

  /* v2.11: the lightbox closes on its button or a backdrop click. */
  document.getElementById("imgLightboxClose").addEventListener("click", function () {
    closeImageLightbox();
  });
  document.getElementById("imgLightbox").addEventListener("click", function (ev) {
    if (ev.target === ev.currentTarget) { closeImageLightbox(); }
  });

  /* v2.11: the image editor's controls. The canvas takes the pen
     (pointer events cover mouse, touch, and pen through one path);
     the crop box and its handles take the crop drags. */
  const imgEditorCanvas = document.getElementById("imgEditorCanvas");
  imgEditorCanvas.addEventListener("pointerdown", onImageEditorPointerDown);
  imgEditorCanvas.addEventListener("pointermove", onImageEditorPointerMove);
  imgEditorCanvas.addEventListener("pointerup", onImageEditorPointerUp);
  imgEditorCanvas.addEventListener("pointercancel", onImageEditorPointerUp);
  const imgCropBox = document.getElementById("imgCropBox");
  imgCropBox.addEventListener("pointerdown", onImageCropPointerDown);
  imgCropBox.addEventListener("pointermove", onImageCropPointerMove);
  imgCropBox.addEventListener("pointerup", onImageCropPointerUp);
  imgCropBox.addEventListener("pointercancel", onImageCropPointerUp);
  document.getElementById("imgEditorTools").addEventListener("click", function (ev) {
    const st = imgEditorState;
    if (!st) { return; }
    const target = ev.target;
    const colorBtn = target && target.closest ?
      target.closest("button[data-color]") : null;
    if (colorBtn) {
      st.color = colorBtn.getAttribute("data-color");
      st.tool = "pen";
      document.querySelectorAll("#imgEditorTools .img-color")
        .forEach(function (b) {
          b.classList.toggle("current", b === colorBtn);
        });
      document.getElementById("imgEditorTextBtn")
        .classList.remove("current");
      return;
    }
    const widthBtn = target && target.closest ?
      target.closest("button[data-width]") : null;
    if (widthBtn) {
      st.widthPx = Number(widthBtn.getAttribute("data-width")) || 3;
      document.querySelectorAll("#imgEditorTools .img-width-btn")
        .forEach(function (b) {
          b.classList.toggle("current", b === widthBtn);
        });
    }
  });
  document.getElementById("imgEditorTextBtn").addEventListener("click", function () {
    const st = imgEditorState;
    if (!st) { return; }
    st.tool = st.tool === "text" ? "pen" : "text";
    document.getElementById("imgEditorTextBtn")
      .classList.toggle("current", st.tool === "text");
  });
  document.getElementById("imgEditorUndoBtn").addEventListener("click", function () {
    const st = imgEditorState;
    if (!st) { return; }
    st.marks.pop();
    redrawImageEditor();
  });
  document.getElementById("imgEditorClearBtn").addEventListener("click", function () {
    const st = imgEditorState;
    if (!st) { return; }
    st.marks = [];
    st.current = null;
    redrawImageEditor();
  });
  document.getElementById("imgEditorCancelBtn").addEventListener("click", function () {
    closeImageEditor();
  });
  document.getElementById("imgEditorSaveBtn").addEventListener("click", function () {
    saveImageEditor().catch(function (err) { toast(err.message, true); });
  });
  document.getElementById("imgEditorModal").addEventListener("click", function (ev) {
    if (ev.target === ev.currentTarget) { closeImageEditor(); }
  });

  /* v2.11: clicking an image's caption opens its editor (a
     prompt; the figure is contenteditable false, so in place
     typing is not attempted). Locked notes never reach it: their
     bodies are not editable and the caption carries no listener
     effect there, editImageCaption checks the lock itself. */
  document.getElementById("noteBody").addEventListener("click", function (ev) {
    const target = ev.target;
    const fig = target && target.closest ?
      target.closest("figcaption.ss-caption") : null;
    if (fig) { editImageCaption(fig); }
  });

  /* v1.3.1: Escape closes the popup, and scrolling the editor closes it
     too, since its fixed position is tied to where the link was.
     v2.9: the same for the bar, with one refinement: Escape deals
     with the innermost thing first, so with the view menu open it
     closes only the menu, and the next Escape closes the bar. (The
     Maximize handler's capture phase snapshot counts both as open
     overlays, so neither Escape leaves Maximize.) */
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") { return; }
    if (linkViewMenuOpen()) { closeLinkViewMenu(); return; }
    hideLinkBar();
  });
  document.querySelector(".editor-scroll").addEventListener("scroll", function () {
    hideLinkBar();
  });
  /* v1.7: scrolling the editor closes the image menu too, since its
     fixed position is tied to where the image was. */
  document.querySelector(".editor-scroll").addEventListener("scroll", function () {
    closeAttMenu();
  });

  /* v2.2: table editing wiring. The caret watcher runs on body
     clicks and keyups and on document selectionchange, so the Table
     button follows the caret into and out of tables however it got
     there (mouse, keyboard, or a table action's caret placement). */
  const noteBodyForTables = document.getElementById("noteBody");
  noteBodyForTables.addEventListener("click", updateTableMenu);
  noteBodyForTables.addEventListener("keyup", updateTableMenu);
  document.addEventListener("selectionchange", updateTableMenu);
  /* The button toggles the menu. mousedown is prevented so clicking
     it never moves the editor selection away from the caret's cell;
     the menu then acts on the cell captured when it opened. */
  const tableMenuBtn = document.getElementById("tableMenuBtn");
  tableMenuBtn.addEventListener("mousedown", function (ev) {
    ev.preventDefault();
  });
  tableMenuBtn.addEventListener("click", function () {
    const menu = document.getElementById("tableMenu");
    if (menu.classList.contains("hidden")) { openTableMenu(); }
    else { closeTableMenu(); }
  });
  /* The menu's items run through one delegated listener, like the
     image menu's. */
  document.getElementById("tableMenu").addEventListener("click", function (ev) {
    const target = ev.target;
    const btn = target && target.closest ?
      target.closest("button[data-table-action]") : null;
    if (!btn || btn.disabled) { return; }
    runTableAction(btn.getAttribute("data-table-action"));
  });
  /* Clicking anywhere else closes the menu (the button itself, which
     toggles, is excluded), mirroring the image menu's rule. */
  document.addEventListener("click", function (ev) {
    const menu = document.getElementById("tableMenu");
    if (!menu || menu.classList.contains("hidden")) { return; }
    const target = ev.target;
    if (!target || !target.closest) { return; }
    if (target.closest("#tableMenu")) { return; }
    if (target.closest("#tableMenuBtn")) { return; }
    closeTableMenu();
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { closeTableMenu(); }
  });
  /* Scrolling the editor moves the table under its parked button, so
     the menu closes and the button re-parks on the table, mirroring
     how the image menu closes on scroll. */
  document.querySelector(".editor-scroll").addEventListener("scroll", function () {
    closeTableMenu();
    if (tableMenuTable &&
        !document.getElementById("tableMenuBtn").classList.contains("hidden")) {
      positionTableMenuBtn();
    }
  });

  /* v2.3: per-cell table menu, filter chip, and multi-cell
     selection wiring. */
  wireCellMenu();
  /* v2.92.0: table resize wiring (strips, handle, watchers). */
  wireTableResize();

  /* Toolbar buttons. mousedown is prevented so the text selection in the
     editor is not lost before execCommand runs. */
  document.querySelectorAll("#toolbar button").forEach(function (btn) {
    /* Only plain data-cmd buttons are formatting commands. The menu,
       select, and color buttons are not commands; they are wired
       separately (wireToolbar, just below). */
    if (!btn.getAttribute("data-cmd")) { return; }
    btn.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
    btn.addEventListener("click", function () {
      runToolbarCommand(btn.getAttribute("data-cmd"));
      /* v2.24.5: on phones a completed command closes the
         More panel, whether the button sits on the line or
         in the panel. Desktop never opens the panel, so the
         mode check is what keeps this phone only. */
      if (tbPhoneMode) { closeTbPanel(); }
    });
  });

  /* v1.3: the grouped toolbar's menus, selects, and color palettes are
     wired separately (the generic loop above only owns the plain
     data-cmd command buttons). */
  wireToolbar();

  /* v1.2 hidden file picker, opened by startAttachFlow() from the
     Insert menu. This change handler feeds the picked files to the
     upload flow. (v1.3.4: the toolbar Attach button that used to be
     wired here is gone; startAttachFlow is the only way in.) */
  document.getElementById("attachFileInput").addEventListener("change", function (ev) {
    /* Copy first: clearing the input also empties its live FileList. */
    const files = Array.prototype.slice.call(ev.target.files || []);
    ev.target.value = "";   /* allow picking the same file again later */
    handleIncomingFiles(files).catch(function (err) {
      toast("Attach failed: " + err.message, true);
    });
  });

  /* v1.2 drag and drop onto the editor body, with a visible outline
     while files are being dragged over it. */
  const noteBodyEl = document.getElementById("noteBody");
  noteBodyEl.addEventListener("dragover", function (ev) {
    ev.preventDefault();
    noteBodyEl.classList.add("drag-over");
  });
  noteBodyEl.addEventListener("dragleave", function () {
    noteBodyEl.classList.remove("drag-over");
  });
  noteBodyEl.addEventListener("drop", function (ev) {
    ev.preventDefault();
    noteBodyEl.classList.remove("drag-over");
    if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) {
      /* v1.6: dropped files land where they were dropped. Aim the
         shared caret memory at the drop point before the upload flow
         reads it; when the point maps to no caret inside the body,
         the previous behavior (saved caret, else append) stands. */
      const dropRange = caretRangeFromPoint(ev.clientX, ev.clientY);
      if (dropRange && noteBodyEl.contains(dropRange.startContainer)) {
        savedCaretRange = dropRange;
      }
      handleIncomingFiles(ev.dataTransfer.files).catch(function (err) {
        toast("Attach failed: " + err.message, true);
      });
    }
  });

  /* v1.2 paste: image files on the clipboard become attachments.
     v2.18: HTML pastes are intercepted too, so their background
     styling can be stripped before the content lands (see
     stripPastedBackgrounds): a paste from an email client
     otherwise brings the message's white background with it,
     painted on the pasted paragraphs, where no formatting
     command could reach it. The cleaned fragment goes in
     through the same insertHTML the browser's own paste would
     use, and everything else about the paste is preserved.
     Plain text pastes (no HTML on the clipboard) still fall
     through to the normal editor behavior.
     v2.23: the interception now lands the paste in the
     configured default mode (Settings, Default paste) and
     retains both payloads for the Paste options popup (see
     the paste options block): the session's start bookmark is
     the caret the paste lands at, read BEFORE the insert, and
     its end bookmark is the caret the insert leaves behind.
     File pastes return above and never raise the popup. */
  noteBodyEl.addEventListener("paste", function (ev) {
    const files = ev.clipboardData ? ev.clipboardData.files : null;
    if (files && files.length) {
      ev.preventDefault();
      captureCaret();
      handleIncomingFiles(files).catch(function (err) {
        toast("Attach failed: " + err.message, true);
      });
      return;
    }
    /* v2.40.0: a paste whose caret sits in a code block
       lands as plain text only (see insertPlainTextIntoCode):
       Evernote's code blocks hold plain text, and the rich
       payload would otherwise carry spans and styles into
       the block. The Paste options popup never opens for
       it: there is no formatting choice to offer about
       plain text. Decided before the HTML branch below,
       and only when the clipboard actually carries text;
       a paste with no text payload falls through to the
       ordinary paths. */
    const codePre = codeBlockAtSelection();
    if (codePre) {
      let plainText = "";
      try {
        plainText = ev.clipboardData.getData("text/plain") || "";
      } catch (e) { plainText = ""; }
      if (plainText &&
          insertPlainTextIntoCode(codePre, plainText)) {
        ev.preventDefault();
        captureCaret();
        closePastePopup();
        return;
      }
    }
    let htmlText = "";
    try {
      htmlText = (ev.clipboardData &&
        typeof ev.clipboardData.getData === "function")
        ? ev.clipboardData.getData("text/html") : "";
    } catch (e) { htmlText = ""; }
    if (htmlText) {
      ev.preventDefault();
      let plainText = "";
      try {
        plainText = ev.clipboardData.getData("text/plain") || "";
      } catch (e) { plainText = ""; }
      const startBm = pasteSelectionBookmark(false);
      captureCaret();
      const mode = ["source", "merge", "text"]
        .indexOf(state.defaultPasteMode) >= 0
        ? state.defaultPasteMode : "source";
      document.execCommand("insertHTML", false,
        renderPasteForMode(mode, htmlText, plainText));
      markDirty();
      const endBm = pasteSelectionBookmark(true);
      if (startBm && endBm) {
        pastePopupSession = {
          html: htmlText, text: plainText, mode: mode,
          start: startBm, end: endBm,
          /* The paste's own input event follows this handler;
             the mark excuses exactly that one event from the
             typing dismissal (see the popup wiring). */
          fresh: true
        };
        showPastePopup();
      } else {
        closePastePopup();
      }
    }
  });

  /* v1.6 drag to move attachments (see the helpers in the attachments
     section). These listeners only engage while an attachment drag is
     in flight: text drags inside the editor and file drags from the
     OS keep their existing behavior, because every handler here
     returns immediately when attachmentDragEl is unset. */
  noteBodyEl.addEventListener("dragstart", function (ev) {
    const note = currentNote();
    if (!note || note.trashed || note.archived) { return; }
    if (ev.target && ev.target.closest &&
        (ev.target.closest(".ss-grip") ||
         ev.target.closest(".ss-att-menu-btn") ||
         /* v2.14.1: the audio card's menu button gets the same
            protection as the image's. */
         ev.target.closest(".ss-card-menu-btn"))) {
      ev.preventDefault();
      return;
    }
    const holder = attachmentHolderOf(ev.target);
    if (!holder || !noteBodyEl.contains(holder)) { return; }
    attachmentDragEl = holder;
    holder.classList.add("ss-dragging");
    if (ev.dataTransfer) {
      ev.dataTransfer.effectAllowed = "move";
      try { ev.dataTransfer.setData("text/plain", ""); } catch (e) { /* older engines */ }
    }
  });
  noteBodyEl.addEventListener("dragover", function (ev) {
    if (!attachmentDragEl) { return; }
    ev.preventDefault();
    if (ev.dataTransfer) { ev.dataTransfer.dropEffect = "move"; }
    updateAttachmentDropIndicator(ev);
  });
  noteBodyEl.addEventListener("drop", function (ev) {
    if (!attachmentDragEl) { return; }
    ev.preventDefault();
    ev.stopPropagation();
    const dragged = attachmentDragEl;
    /* v2.25: a Free move figure drops at any caret point in
       the text flow; every other figure keeps the ordinary
       block move. */
    if (dragged.getAttribute("data-ss-align") === "free") {
      moveFreeAttachmentToPoint(dragged, ev.clientX, ev.clientY);
    } else {
      moveAttachmentToPoint(dragged, ev.clientX, ev.clientY);
    }
    clearAttachmentDrag();
    markDirty();
  });
  noteBodyEl.addEventListener("dragend", function () {
    clearAttachmentDrag();
  });

  /* v1.6 image selection for resizing. This is its own listener so
     the checkbox and link click handlers above stay untouched:
     clicking an inline image selects its block; clicking anywhere
     else in the body clears the selection. Clicks on the card's own
     buttons keep working; they merely also clear a selection, which
     is invisible unless a resize was in progress. */
  noteBodyEl.addEventListener("click", function (ev) {
    const target = ev.target;
    if (target && target.closest &&
        (target.closest(".ss-grip") ||
         target.closest(".ss-att-menu-btn"))) { return; }
    const note = currentNote();
    const holder = attachmentHolderOf(target);
    /* v1.7: selection resolves through the holder and its record,
       not through the exact element the click landed on. The v1.6
       handler required the target to be the hydrated <img> itself,
       which is one of the ways a freshly inserted image (whose DOM
       had not been through note reopen hydration) slipped past it.
       A click anywhere on an image block that is not a button or a
       link now selects the block. */
    if (holder && note && !note.trashed && !note.archived) {
      const attId = holder.getAttribute("data-attachment-id");
      const att = (note.attachments || []).find(function (a) {
        return a.id === attId;
      });
      if (att && isImageAttachment(att) &&
          !(target && target.closest &&
            target.closest("button, a"))) {
        selectAttachment(holder);
        return;
      }
    }
    deselectAttachment();
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { deselectAttachment(); }
  });
  /* v1.7: Escape closes the image menu as well (deselecting above
     already closes it; this covers a menu open with its selection
     somehow already gone). */
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { closeAttMenu(); }
  });

  /* v1.6 checklist Enter behavior (see handleChecklistEnter in the
     editor section). Only a plain Enter with the caret inside a
     checklist item is intercepted; Shift+Enter and every other Enter
     keep the browser default.
     v2.101.0: the same listener runs the plain lists' exit
     (handlePlainListEnter) behind the checklist's claim, so Enter
     on the empty last item of a bullet or numbered list lands in
     a paragraph, not the div the browser chooses. */
  noteBodyEl.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter" && !ev.shiftKey) {
      if (handleChecklistEnter()) { ev.preventDefault(); }
      else if (handlePlainListEnter()) {
        ev.preventDefault();
      }
    }
  });

  /* v2.101.0: the checklist's Backspace at an item's start is the
     app's too (see handleChecklistBackspace): left to the browser
     it deletes the item's checkbox as a unit instead of editing
     text. Modified chords belong to the browser and are left
     alone. */
  noteBodyEl.addEventListener("keydown", function (ev) {
    if (ev.key === "Backspace" && !ev.ctrlKey &&
        !ev.metaKey && !ev.altKey) {
      if (handleChecklistBackspace()) {
        ev.preventDefault();
      }
    }
  });

  /* v2.40.0 code block Enter behavior (see handleCodeBlockEnter
     in the editor section). An Enter with the caret inside a
     code block is the app's own edit, so the stored form does
     not depend on the browser's contenteditable split: a plain
     newline inside the block, and the exit onto a paragraph
     from the block's empty last line. Plain and Shift+Enter
     are both the block's (a code block has no second Enter
     meaning); modified chords are never claimed, and an Enter
     the handler does not claim keeps the browser default. */
  noteBodyEl.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter" && !ev.ctrlKey && !ev.metaKey &&
        !ev.altKey) {
      if (handleCodeBlockEnter()) { ev.preventDefault(); }
    }
  });


  /* v2.97.0, narrowed in v2.99.0: forward Delete at
     the one caret position a code block Enter leaves
     (see handleCodeBlockBeforeInput in the editor
     section): with the caret furniture standing,
     typing and Backspace at that position are the
     browser's own again, and only forward Delete,
     which would pull the next block into the pre,
     is still the app's there. */
  noteBodyEl.addEventListener("beforeinput", function (ev) {
    if (handleCodeBlockBeforeInput(ev)) {
      ev.preventDefault();
    }
  });
  /* v2.25: Backspace or Delete in an empty line beside an
     image removes only the empty line, never the image (see
     emptyLineDeleteGuard in the attachments section). The
     handler runs only when the guard takes the keypress. */
  noteBodyEl.addEventListener("keydown", function (ev) {
    if (emptyLineDeleteGuard(ev)) { ev.preventDefault(); }
  });

  /* v2.4: Tab and Shift+Tab belong to the note while the caret is
     in it (see handleBodyTabKey in the editor section): table cell
     navigation, multi block indent and outdent, and real tab
     characters, never a focus jump out of the editor. v2.7 added
     sub-list indent and outdent for list items to that list. The
     handler decides whether the key is the note's; only then is
     the browser default (focus movement) prevented. */
  noteBodyEl.addEventListener("keydown", function (ev) {
    if (ev.key === "Tab" && handleBodyTabKey(ev)) {
      ev.preventDefault();
    }
  });

  /* v2.1.0: Link to Note picker controls. Typing in the search box
     filters the results list; Cancel, a click on the dimmed backdrop,
     or Escape closes the picker without inserting anything. */
  document.getElementById("noteLinkCancelBtn").addEventListener("click", closeNoteLinkPicker);
  document.getElementById("noteLinkModal").addEventListener("click", function (ev) {
    if (ev.target === ev.currentTarget) { closeNoteLinkPicker(); }
  });
  document.getElementById("noteLinkSearch").addEventListener("input", function (ev) {
    renderNoteLinkResults(ev.target.value);
  });
  document.getElementById("noteLinkModal").addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { closeNoteLinkPicker(); }
  });

  /* v2.1.0: the notes list toolbar Import button and its hidden file
     input. The change handler copies the FileList into a plain array
     BEFORE clearing the input (the v1.2.1 lesson: clearing the input
     empties its live FileList and would leave the import with no
     files), and clearing is what lets the same file be picked twice. */
  document.getElementById("listImportBtn").addEventListener("click", function () {
    document.getElementById("importFileInput").click();
  });
  document.getElementById("importFileInput").addEventListener("change", function (ev) {
    const files = Array.prototype.slice.call(ev.target.files || []);
    ev.target.value = "";
    if (files.length) {
      importFiles(files).catch(function (err) {
        toast("Import failed: " + err.message, true);
      });
    }
  });

  /* v2.1.0: the editor footer Export menu (it opens upward; see the
     .tb-menu.up rule). Picking an item closes the menu and runs that
     export; clicking anywhere outside the wrap closes the menu. */
  document.getElementById("exportBtn").addEventListener("click", function (ev) {
    ev.stopPropagation();
    document.getElementById("exportMenu").classList.toggle("hidden");
  });
  document.getElementById("exportMenu").querySelectorAll("button[data-export]")
    .forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.getElementById("exportMenu").classList.add("hidden");
        const kind = btn.getAttribute("data-export");
        if (kind === "txt") { exportNoteTxt(); }
        else if (kind === "docx") { exportNoteDocx(); }
        else if (kind === "pdf") { exportNotePdf(); }
      });
    });
  document.addEventListener("click", function (ev) {
    const menu = document.getElementById("exportMenu");
    if (menu.classList.contains("hidden")) { return; }
    const target = ev.target;
    if (target && target.closest && target.closest(".export-wrap")) { return; }
    menu.classList.add("hidden");
  });


  /* Trash and archive actions. */
  document.getElementById("trashBtn").addEventListener("click", function () {
    const note = currentNote();
    if (note) {
      moveNoteWithProgress("Deleting", "Deleted",
        "Moved to Trash.", function () {
          return moveNoteToTrash(note, false);
        }, moveUndoSnapshot("trash", [note]))
        .catch(function (err) { toast(err.message, true); });
    }
  });
  document.getElementById("restoreBtn").addEventListener("click", function () {
    const note = currentNote();
    if (note) {
      moveNoteWithProgress("Restoring", "Restored",
        "Note restored.", function () {
          return restoreNote(note);
        }).then(function () {
        state.view = { kind: "notebook", value: note.notebook };
        renderAll();
        openNote(note.id);
      }).catch(function (err) { toast(err.message, true); });
    }
  });
  /* v1.5: Archive and Unarchive mirror Trash and Restore. */
  document.getElementById("archiveBtn").addEventListener("click", function () {
    const note = currentNote();
    if (note) {
      moveNoteWithProgress("Archiving", "Archived",
        "Note archived.", function () {
          return archiveNote(note);
        }, moveUndoSnapshot("archive", [note]))
        .catch(function (err) { toast(err.message, true); });
    }
  });
  document.getElementById("unarchiveBtn").addEventListener("click", function () {
    const note = currentNote();
    if (note) {
      moveNoteWithProgress("Unarchiving", "Unarchived",
        "Note unarchived.", function () {
          return unarchiveNote(note);
        }).then(function () {
        state.view = { kind: "notebook", value: note.notebook };
        renderAll();
        openNote(note.id);
      }).catch(function (err) { toast(err.message, true); });
    }
  });
  document.getElementById("deleteForeverBtn").addEventListener("click", function () {
    /* v2.58: the flow is confirmDeleteNoteForever now, a
       top level function beside deleteNoteForever, so the
       Trash context menu's Delete Forever item runs the
       identical confirmation and cleanup. */
    confirmDeleteNoteForever(currentNote());
  });

  /* Online and offline events drive the sync pill and auto flush the
     queue when the browser comes back online. */
  window.addEventListener("online", function () {
    state.online = true;
    refreshSyncPill();
    /* Readiness is storeSyncReady(): a connected store plus a live
       Google sign in in memory, so coming back online auto syncs. */
    if (storeSyncReady()) { syncNow(false); }
  });
  window.addEventListener("offline", function () {
    state.online = false;
    refreshSyncPill();
  });

  /* v2.15: returning to the tab is a renewal trigger (see
     maybeRenewGoogleOnVisible): background tabs get their
     timers throttled, so the scheduled renewal may not have
     run while the user was away. */
  document.addEventListener("visibilitychange", function () {
    maybeRenewGoogleOnVisible();
  });

  /* v2.16: the auto-sync idle clock (see the auto-sync block).
     Key presses, pointer presses, and input events anywhere in
     the document count as activity; the listeners sit in the
     capture phase so a handler deeper in the tree cannot
     swallow an event before the clock sees it. Ordinary caret
     movement by click is a pointer press, and typing is both
     keydown and input, so the clock reads any real editing. */
  ["keydown", "pointerdown", "input"].forEach(function (type) {
    document.addEventListener(type, noteUserActivity, true);
  });
}

/* --------------------------------------------------------------------------
   Boot routing (v2.0)
   initialScreenFor is a pure decision function: it reads nothing and
   changes nothing, so it can be tested on its own. Its rules are the
   whole sign in model in one place:
     A live Google token already in this session goes straight to
       the app.
     A returning device (a device key, saved settings, or any legacy
       artifact from an older build) goes to the Google sign in
       gate.
     Anything else is a first run and goes to setup.
   There is no lock screen and no password anywhere in this model:
   Google sign in is the only sign in.
   -------------------------------------------------------------------------- */
function initialScreenFor(input) {
  if (input && input.hasLiveToken) { return "app"; }
  if (input && (input.hasDeviceKey || input.hasSettings ||
      input.hasLegacyArtifacts)) {
    return "googleGate";
  }
  return "setup";
}

/* Prepare the Google gate for a returning user: load or create the
   device key, then try to enter without bothering the user: first a
   token that is still live, then one silent Worker renewal. Only when
   both fail does the gate itself appear, and it appears quietly: no
   error toast is raised for a background renewal that did not work.
   (Legacy artifacts were already cleaned by boot before this runs.)
   v2.79.0: a Worker sign in return is settled first, before any
   status question is asked: an error or denied fragment shows the
   gate with its plain message and nothing else is attempted, and a
   session fragment is persisted into the encrypted store, from
   where the silent attempt below spends it. The legacy GIS token
   migration runs on the same pass, so a device with no session
   never enters on a credential this build cannot renew. */
async function prepareGoogleGate() {
  /* Boot lands here with the loading overlay already up; keep it up
     (with an honest status) through the silent sign in attempt.
     Every exit from this function either hands over to
     connectAndLoad, which manages the overlay from there, or shows
     the Google gate, which hides it. */
  showLoading("Checking your Google sign in...");
  try {
    await loadOrCreateDeviceKey();
  } catch (e) {
    showGoogleConnectScreen();
    document.getElementById("repoError").textContent =
      "This device could not prepare its local encryption key: " + e.message;
    return;
  }
  if (pendingWorkerAuth && pendingWorkerAuth.kind !== "session") {
    const denied = pendingWorkerAuth.kind === "denied";
    pendingWorkerAuth = null;
    showGoogleConnectScreen(denied
      ? "That Google account is not authorized for this app."
      : "Sign in did not complete. Please try again.");
    return;
  }
  if (pendingWorkerAuth && pendingWorkerAuth.kind === "session") {
    try {
      await persistPendingWorkerSession();
    } catch (e) {
      pendingWorkerAuth = null;
      showGoogleConnectScreen(
        "Sign in did not complete. Please try again.");
      return;
    }
  }
  migrateLegacyGoogleToken();
  let status = null;
  try { status = await providers.google.getStatus(); }
  catch (e) { status = null; }
  if (status && status.connected) {
    await connectAndLoad();
    return;
  }
  if (await googleTrySilentSignIn()) {
    await connectAndLoad();
    return;
  }
  showGoogleConnectScreen();
}

/* --------------------------------------------------------------------------
   v2.6.0: installable app (PWA) wiring

   The install pieces are separate files served from the site root:
   manifest.webmanifest, sw.js, and the generated PNG icons named in
   the head of this file. This block is the page side of that story:
   it registers the service worker and runs the Install app button.

   Registration is guarded three ways, and every failure is silent:
   the browser must expose navigator.serviceWorker, the page must be
   served over HTTPS (or from localhost, where service workers are
   also allowed), and the whole attempt sits in a try and catch with
   a caught promise. A standalone copy of this file opened from disk
   or served from anywhere else therefore behaves exactly as it did
   before v2.6.0: no worker, no prompt, no error.

   The install item listens for beforeinstallprompt, which
   Chromium based browsers fire when the site is installable. The
   event is stashed (its default mini infobar suppressed), the
   sidebar menu's Install app item is unhidden (v2.7: it was a
   standalone footer button through v2.6.0), and clicking it
   plays the stash back. The item hides again once the prompt
   has been used, whether it was accepted or dismissed (a later
   offer fires the event again and brings the item back), and
   for good once the appinstalled event lands. Browsers that
   never fire the event (iOS Safari) never show the item; the
   Apple metas and touch icon in the head cover that path
   instead.
   -------------------------------------------------------------------------- */
let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", function (ev) {
  ev.preventDefault();
  deferredInstallPrompt = ev;
  const btn = document.getElementById("sidebarInstallItem");
  if (btn) { btn.classList.remove("hidden"); }
});

window.addEventListener("appinstalled", function () {
  deferredInstallPrompt = null;
  const btn = document.getElementById("sidebarInstallItem");
  if (btn) { btn.classList.add("hidden"); }
});

/* Play the stashed install prompt back. The outcome is recorded the
   only way the app needs: the stash is spent and the item hides,
   whichever way the user answered. */
async function promptInstallApp() {
  const btn = document.getElementById("sidebarInstallItem");
  const promptEvent = deferredInstallPrompt;
  deferredInstallPrompt = null;
  if (btn) { btn.classList.add("hidden"); }
  if (!promptEvent) { return; }
  try {
    promptEvent.prompt();
    await promptEvent.userChoice;
  } catch (err) { /* a spent or refused prompt is not an app error */ }
}

function registerServiceWorker() {
  try {
    if (!("serviceWorker" in navigator)) { return; }
    const proto = window.location.protocol;
    const host = window.location.hostname;
    const secureEnough = proto === "https:" ||
      (proto === "http:" &&
        (host === "localhost" || host === "127.0.0.1"));
    if (!secureEnough) { return; }
    navigator.serviceWorker.register("sw.js").then(function (reg) {
      /* v2.21: ask for an update check on every boot. The page
         is served cache first now, so discovering a new worker
         promptly is what keeps releases arriving: the check
         itself is one small request for sw.js, and the new
         worker precaches the new build's page under its new
         cache name before it activates. A failed check is as
         silent as a failed registration. */
      if (reg && typeof reg.update === "function") {
        reg.update().catch(function () { /* silent, as below */ });
      }
      /* v2.50: keep the registration and arm the self update
         machinery (the v2.50 block below): update checks
         when the tab returns to visible, and the safe
         reload when a new worker takes control. */
      swRegistration = reg || null;
      armServiceWorkerUpdates();
    }).catch(function () {
      /* Silent by design: the app works the same without the
         worker; it only loses offline shell caching and the
         browser's install offer. */
    });
  } catch (err) { /* silent, same reasoning as above */ }
}

/* --------------------------------------------------------------------------
   v2.50: the self update reload.

   Why: the shell is cache first (see sw.js), so a navigation
   is served the build its controlling worker precached. A
   new release's worker installs in the background, skips
   waiting, and claims the open pages, but claiming is not a
   reload: a page keeps running the build it loaded with
   until something reloads it, which in practice meant a
   hard refresh to be sure of being current. This block
   removes the hard refresh:

   - The registration is asked for an update check on boot
     (registerServiceWorker, above) and again whenever the
     document returns to visible, so a tab left open across
     a release finds the new worker on its own.
   - When a new worker takes control (controllerchange) and
     this page HAD a controller when it booted, the new
     build is the one the next navigation would serve, so
     the page reloads itself onto it. A first ever install
     fires the same event when the first worker claims the
     page; that page is already running the build it just
     fetched, so the had-a-controller test is what keeps a
     first install from reloading pointlessly.
   - The automatic reload happens at most once per running
     build: before reloading, the page records its own
     APP_BUILD in sessionStorage under SW_RELOAD_GUARD_KEY,
     and a page whose build is already recorded never auto
     reloads again for it. If the browser somehow serves
     the same build once more (a CDN edge still
     propagating, say), the guard stops the loop and the
     waiting update is left to the pill, whose click is
     the manual route.
   - Unsaved work is never reloaded away. While the open
     note, the task editor, or a held web clip carries
     unsaved state, the reload waits: the New version ready
     pill shows in the sidebar's sync row, and the reload
     is retried at the moments work lands (the autosave
     completing, the editor closing or switching notes, the
     task editor closing, a clip finishing filing).
     Clicking the pill asks again at once; it never forces
     its way past unsaved work or the guard, it only
     answers, and in the guard's spent case (where the
     screen is clean and the click is the user's own
     instruction) it performs the reload itself.

   Notification arrivals survive by construction: a click
   that opened the app cold leaves its id in the query
   (?task=, ?noteReminder=); the boot readers lift it into
   memory synchronously at boot, before any reload can be
   pending (registration is asynchronous, and the worker
   still has to be fetched, installed, and activated); the
   readers never strip the query; and the reload reloads
   this page's own URL untouched, so a waiting arrival is
   simply read again by the new build's boot.
   -------------------------------------------------------------------------- */

/* The registration register() resolved with, kept so the
   visibility look can ask it for update checks. */
let swRegistration = null;

/* Whether a new worker has taken control and this page is
   still running the build it loaded with. Set once per
   arrival (onSwControllerChange), cleared when the reload
   is performed. */
let swUpdatePending = false;

/* The editor's unsettled edit counts. markDirty bumps the
   dirty count on every edit it announces; the autosave
   raises the settled count to the count it collected when
   a save lands (written, queued offline, or preserved
   through a conflict; a paused or failed save settles
   nothing). swEditorUnsettled() is the dirty editor test
   updateReloadBlocked uses. The judgment counts
   settlements rather than comparing content against the
   saved baseline for a reason found in testing: a stored
   body carrying a boolean attribute (every checklist's
   checked) re-serializes from the editor's DOM in a
   different string form (checked=""), so a freshly opened
   note compares unequal to its baseline though the user
   has typed nothing, and a comparison would make the
   reload wait on work that does not exist. The counts
   carry the same contract the save state line shows the
   user: "Unsaved changes..." from markDirty until the
   save lands. */
let swEditorDirtySeq = 0;
let swEditorSettledSeq = 0;
function swEditorUnsettled() {
  return swEditorDirtySeq > swEditorSettledSeq;
}

/* The sessionStorage key of the reload guard: its value is
   the APP_BUILD of the page that already spent its one
   automatic reload (see the block head). */
const SW_RELOAD_GUARD_KEY = "snakescale.swReloadedFromBuild";

/* Did this page have a controlling worker when it booted?
   Captured at script evaluation, before any worker this
   session installs can claim the page and change the
   answer. */
const swHadControllerAtBoot = (function () {
  try {
    return !!("serviceWorker" in navigator &&
      navigator.serviceWorker.controller);
  } catch (err) { return false; }
})();

/* The one navigation the update machinery performs, kept
   as a named seam the way the scan and sketch export seams
   are kept (scanCanvasToBlob, sketchExportToBlob): the
   decision logic around it is the app's own and runs for
   real everywhere; the seam is the single line that asks
   the browser to load this page's URL again, query and
   all, which is what carries a waiting notification
   arrival through (see the block head). */
function reloadForUpdate() {
  window.location.reload();
}

/* Has this page's build already spent its automatic
   reload? Storage can refuse (a private window's quirks);
   an unreadable guard reads as unspent, and the pending
   flag's set-once shape still keeps one page from
   reloading twice for one arrival. */
function swReloadGuardSpent() {
  try {
    return window.sessionStorage.getItem(SW_RELOAD_GUARD_KEY) ===
      APP_BUILD;
  } catch (err) { return false; }
}

function swSpendReloadGuard() {
  try {
    window.sessionStorage.setItem(SW_RELOAD_GUARD_KEY,
      APP_BUILD);
  } catch (err) { /* the guard's read side treats a failed
                    write as unspent; see above */ }
}

/* Is there work on screen a reload would lose? A web clip
   still held for sign in (or mid filing), the task
   editor's own dirty flag, and the open note's unsettled
   edits: the same three classes of unsaved state, each
   with its own landing hook. With no note open there are
   no editor fields holding work; a trashed or archived
   note is read only and never busy (markDirty does not
   count its edits in the first place). */
function updateReloadBlocked() {
  if (pendingWebClip || webClipFiling) { return true; }
  if (taskEditorState && taskEditorState.dirty) { return true; }
  const note = currentNote();
  if (!note || note.trashed || note.archived) { return false; }
  return swEditorUnsettled();
}

/* Show or hide the New version ready pill to match the
   pending flag. The pill lives in the sidebar's sync row;
   in the icon rail the sidebar is not rendered and the
   pill simply is not on screen, while the flag and the
   landing hooks keep working, and the pill is there when
   the sidebar is shown again. */
function renderUpdateReadyPill() {
  const pill = document.getElementById("updateReadyPill");
  if (pill) { pill.classList.toggle("hidden", !swUpdatePending); }
}

/* Try to land a waiting update now: the one path every
   reload decision goes through. Nothing pending, a spent
   guard, or unsaved work on screen each leave the page
   exactly as it is; in the guard's case the pill stays up
   as the manual route (see onUpdateReadyPillClick). */
function maybeReloadForUpdate() {
  if (!swUpdatePending) { return; }
  if (swReloadGuardSpent()) { return; }
  if (updateReloadBlocked()) { return; }
  swSpendReloadGuard();
  swUpdatePending = false;
  renderUpdateReadyPill();
  reloadForUpdate();
}

/* A new worker has taken control of this page. A first
   install's claim is not an update (see the block head):
   with no controller at boot there is nothing newer to
   reload onto. Otherwise the update is pending from this
   moment: reload at once when the screen is clean, and
   let the pill and the landing hooks carry it when it is
   not. The toast fires only on the waiting path, once per
   arrival (the pending flag is set before it can repeat). */
function onSwControllerChange() {
  if (!swHadControllerAtBoot) { return; }
  if (swUpdatePending) { return; }
  swUpdatePending = true;
  renderUpdateReadyPill();
  if (!swReloadGuardSpent() && updateReloadBlocked()) {
    toast("A new version of SnakeScale Notes is ready. " +
      "It will load as soon as your unsaved work is saved.");
  }
  maybeReloadForUpdate();
}

/* Arm the machinery once the registration resolves: the
   controller listener, and the visibility look that asks
   for an update check whenever the document comes back to
   the front (the reminder schedulers take the same look
   in wireEvents; this one is the worker's). */
function armServiceWorkerUpdates() {
  try {
    if ("serviceWorker" in navigator &&
        typeof navigator.serviceWorker.addEventListener ===
          "function") {
      navigator.serviceWorker.addEventListener(
        "controllerchange", onSwControllerChange);
    }
  } catch (err) { /* no worker events, no self update */ }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") { return; }
    if (swRegistration &&
        typeof swRegistration.update === "function") {
      swRegistration.update().catch(function () {
        /* silent, like the boot check */
      });
    }
  });
}

/* The pill's click: ask for the reload now. The machinery
   still refuses over unsaved work (and says so, in words
   that cover every kind of unsaved state); the click's
   one extra power is the guard's spent case, where the
   screen is clean and the click is the user's own
   instruction to reload, so it performs the reload
   itself. */
function onUpdateReadyPillClick() {
  if (!swUpdatePending) { return; }
  if (updateReloadBlocked()) {
    toast("The new version loads as soon as your " +
      "unsaved work is saved.");
    return;
  }
  if (swReloadGuardSpent()) {
    swUpdatePending = false;
    renderUpdateReadyPill();
    reloadForUpdate();
    return;
  }
  maybeReloadForUpdate();
}

/* The listeners and the registration run at script evaluation: the
   script sits at the end of the body, so the button exists, and
   beforeinstallprompt can fire early in the page's life, before
   boot() would get to it. */
(function wirePwaInstall() {
  const btn = document.getElementById("sidebarInstallItem");
  if (btn) {
    btn.addEventListener("click", function () {
      /* v2.7: the item lives in the sidebar menu; choosing it
         closes the menu like every other item, then the prompt
         plays. */
      closeSidebarMenu();
      promptInstallApp();
    });
  }
  registerServiceWorker();
})();

/* --------------------------------------------------------------------------
   Boot
   Order matters: logos first (they appear on every screen), then
   saved settings (theme, attachment bookkeeping, list sort), then
   the legacy cleanup for records left by builds before v2.0, then
   event wiring, then the starting route from initialScreenFor.
   Returning users go through prepareGoogleGate; there is no lock
   screen to route to.
   -------------------------------------------------------------------------- */
async function boot() {
  /* v2.79.0: a Worker sign in return arrives in the fragment,
     and it is read and stripped before anything else can trip
     over it: the session token it may carry must never linger
     in the address bar. Its outcome is held in
     pendingWorkerAuth and settled by the gate routing below. */
  readWorkerAuthFragment();
  /* v2.47: a web clip arriving in the fragment is read and
     stripped before anything else can trip over it (see the
     web clipper section head for the auth sequencing note:
     sign in here is a callback flow, never a fragment, so
     this read cannot disturb it). The held clip files from
     connectAndLoad once the store is in. */
  readWebClipFromUrl();
  injectLogos();
  renderAppVersion();
  loadSettings();
  /* v2.24.6: a renewal failure recorded by an earlier session
     stands in the sidebar menu from the start. */
  renderRenewalFailureLine();
  const foundLegacy = cleanupLegacyStorage();
  wireEvents();
  /* v2.47: the Settings bookmarklet link exists from the
     start, not only after Settings is first opened. */
  renderWebClipSettings();
  /* v2.24: a notification click that opened the app cold left
     its task id in the URL; the pending open machinery holds
     it until the first load lands the tasks. The reminder
     scheduler starts here too: its 30 second tick is owned by
     the app itself, independent of the auto-sync setting, and
     its checks simply find no tasks until a store loads. */
  readTaskOpenParamFromUrl();
  startTaskReminderScheduler();
  /* v2.35: the note reminder twins of the two calls above. */
  readNoteReminderParamFromUrl();
  startNoteReminderScheduler();
  /* Small diagnostic hook: the build stamp is searchable in the file,
     and also visible in the console for support. */
  console.log("SnakeScale Notes v" + APP_VERSION + " build " + APP_BUILD);

  /* v2.79.0: a held Worker return routes through the gate's
     preparation whatever the stored state says: the fragment
     is fresh evidence about the sign in, newer than any
     first run or returning device test, and the preparation
     creates the device key itself when this device has none
     yet. */
  if (pendingWorkerAuth) {
    await prepareGoogleGate();
    return;
  }
  const start = initialScreenFor({
    hasDeviceKey: deviceKeyExists(),
    hasSettings: !!localStorage.getItem(LS_SETTINGS),
    hasLegacyArtifacts: foundLegacy,
    hasLiveToken: !!state.providerTokens.google
  });
  if (start === "googleGate") {
    await prepareGoogleGate();
    return;
  }
  if (start === "app") {
    showScreen("app");
    await connectAndLoad();
    return;
  }
  showScreen(start);
  /* Setup is interactive the moment it is shown, so the boot
     loading overlay comes down here. The googleGate and app
     routes manage the overlay inside their own flows. */
  hideLoading();
}

document.addEventListener("DOMContentLoaded", boot);

