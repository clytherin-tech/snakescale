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
   6. The store dispatch layer
   Every note operation in the app (sync, queue flush, notebooks,
   trash, archive, index rebuilds) talks to this small neutral
   surface, never to a driver directly:

     storeGetFile(path)                         -> {text, token} | null
     storeListDir(path)                         -> [{name, path, isDir,
                                                    fileId, token}]
                                                  (v2.20: the file id and
                                                  revision token ride along,
                                                  from the same listing
                                                  metadata; older callers
                                                  simply ignore them)
     storePutFile(path, text, expectedToken, message, options)
                                                -> token string
     storeDeleteFile(path, token, message)

   Paths are store relative ("notebooks/<slug>/<id>.md", "index.json",
   "trash/<id>.md", "archive/<id>.md"). The token is the optimistic
   concurrency marker: for the Google Drive driver (section 11) it
   is a head revision marker. A write whose expectedToken no longer
   matches the stored file throws StoreConflict and the caller
   applies the keep both copies rule; a write never silently
   overwrites a changed file. options.fresh tells the driver the
   caller promises the file does not exist yet, which lets it skip
   its existence check. The message parameter is accepted so the
   sync engine's call shape stays the one it has always used;
   Drive has no commit messages, so it is not used.

   Until v2.0 a second driver (GitHub) sat behind this surface.
   v2.0 has exactly one store, Google Drive, so the four functions
   below call the Drive driver directly. The surface itself is
   unchanged, which is why the sync engine did not have to change.
   -------------------------------------------------------------------------- */
class StoreConflict extends Error {
  constructor(path) {
    super("The file changed in storage before this save finished: " + path);
    this.name = "StoreConflict";
    this.path = path;
  }
}

function isStoreConflict(err) {
  return !!err && (err.name === "StoreConflict" || err instanceof StoreConflict);
}

function splitStorePath(path) {
  return String(path || "").split("/").filter(function (part) {
    return part.length > 0;
  });
}

async function storeGetFile(path) {
  return driveStoreGetFile(path);
}

async function storeListDir(path) {
  return driveStoreListDir(path);
}

async function storePutFile(path, text, expectedToken, message, options) {
  return driveStorePutFile(path, text, expectedToken || null, options || {});
}

async function storeDeleteFile(path, token, message) {
  return driveStoreDeleteFile(path, token || null);
}


/* --------------------------------------------------------------------------
   7. Note file format
   Each note is one .md file. Layout:
     ---
     id: <noteId>
     title: <title, single line>
     notebook: <slug>
     tags: tag one, tag two
     created: <ISO timestamp>
     updated: <ISO timestamp>
     pinned: true or false
     trashedFrom: <slug>          (only on files inside trash/)
     archivedFrom: <slug>         (v1.5, only on files inside archive/)
     attachments: <JSON array>    (v1.2, only when the note has attachments)
     ---

     <HTML body>
   The delimiter is a line of exactly three hyphens. Values never contain
   newlines (titles are flattened on save), which keeps parsing trivial and
   the files friendly to open in any other Markdown tool.
   The v1.2 attachments line is a single line JSON array of small objects:
   {id, provider, fileId, name, storageName, mime, size, created}. JSON
   string escaping guarantees the value stays on one line. The attachment
   v2.76: an audio record may carry one more field, transcript (see
   sanitizeTranscript): the recording's transcribed words, their
   timings, and the model that read them, all inside the same JSON.
   BINARIES never live in the notes store; they sit in the attachments
   subfolder of the user's SnakeScale Notes folder in Google Drive,
   and this line only carries the provider file references.
   Notes written before v1.2 have no attachments line and parse as an
   empty array, so old data loads unchanged.
   -------------------------------------------------------------------------- */
function notePath(note) {
  if (note.trashed) { return "trash/" + note.id + ".md"; }
  /* v1.5: archived notes live in the archive folder, mirroring trash. */
  if (note.archived) { return "archive/" + note.id + ".md"; }
  return "notebooks/" + note.notebook + "/" + note.id + ".md";
}

/* v1.2: attachment metadata cleanup. Keeps only well formed entries with
   the fields the app depends on, coerced to plain strings and numbers, so
   a hand edited note file can never inject odd shapes into the app.
   Every attachment object keeps this exact shape:
   {id, provider, fileId, name, storageName, mime, size, created}.
   v2.46: one optional field rides along only when it is
   exactly true: sketch, the marking of a sketch record
   (see the sketch section). It is absent from every
   other record, so their shape is unchanged.
   v2.76: one more optional field rides along only when
   it holds a well formed transcript: transcript, a
   recording's transcribed words with their timings
   (see sanitizeTranscript). Absent otherwise, same
   rule. */
/* v2.76: one attachment record's transcript, the shape
   transcribeAudioAttachment stores and the audio card reads:
   { text, units, model, at }. text is the whole transcript;
   units, when the run returned timings, are its timed pieces
   ({start, end, text}, seconds, finest first: word level
   when the model produced word timings, the segment chunks
   when it produced only those); model is the speech model
   id that read it; at is when the run finished. Kept only
   when the text is a real string with words in it; the
   units are coerced one by one and dropped when none
   survive (the text then stands plain, with no click
   targets). Returns null for anything else, so a damaged
   or hand edited value degrades to no transcript, never to
   a broken record. The returned object is always freshly
   built, so storing it never shares an object with its
   source. */
function sanitizeTranscript(t) {
  if (!t || typeof t !== "object" || Array.isArray(t)) {
    return null;
  }
  const text = typeof t.text === "string" ? t.text : "";
  if (!text.trim()) { return null; }
  const out = { text: text };
  if (Array.isArray(t.units)) {
    const units = [];
    t.units.forEach(function (u) {
      if (!u || typeof u !== "object") { return; }
      const start = Number(u.start);
      if (!isFinite(start) || start < 0) { return; }
      let end = Number(u.end);
      if (!isFinite(end) || end < start) { end = start; }
      const ut = typeof u.text === "string" ? u.text.trim() : "";
      if (!ut) { return; }
      units.push({ start: start, end: end, text: ut });
    });
    if (units.length) { out.units = units; }
  }
  out.model = typeof t.model === "string" ? t.model : "";
  out.at = typeof t.at === "string" ? t.at : "";
  return out;
}

function sanitizeAttachments(list) {
  if (!Array.isArray(list)) { return []; }
  const out = [];
  list.forEach(function (a) {
    if (!a || typeof a !== "object") { return; }
    if (!a.id || !a.provider || !a.fileId) { return; }
    const rec = {
      id: String(a.id),
      provider: String(a.provider),
      fileId: String(a.fileId),
      name: String(a.name || "file"),
      storageName: String(a.storageName || a.name || "file"),
      mime: String(a.mime || "application/octet-stream"),
      size: Number(a.size) || 0,
      created: String(a.created || "")
    };
    /* v2.46: a sketch's marking on its record, kept only when
       exactly true, so a sketchless record (and a hand edited
       truthy string in the field) serializes exactly as every
       record did before sketches existed. */
    if (a.sketch === true) { rec.sketch = true; }
    /* v2.76: a recording's transcript rides its record
       the same way, kept only when it is a well formed
       transcript (see sanitizeTranscript), so a
       transcriptless record serializes exactly as
       every record did before transcripts lived on
       records. Because every path that reads or writes
       a note's records passes through this function
       (serialize, parse, the editor collect, the cache,
       version snapshots, the drop box import), the
       transcript survives every round trip those paths
       make. */
    const tr = sanitizeTranscript(a.transcript);
    if (tr) { rec.transcript = tr; }
    out.push(rec);
  });
  return out;
}

/* v1.2: counts note files whose attachments line could not be parsed
   during a load. loadAllFromRepo turns a nonzero count into one readable
   toast instead of failing the whole load. */
let attachmentParseWarnings = 0;

function serializeNote(note) {
  const lines = [];
  lines.push("---");
  lines.push("id: " + note.id);
  lines.push("title: " + String(note.title || "").replace(/\s*\n\s*/g, " "));
  lines.push("notebook: " + (note.notebook || ""));
  lines.push("tags: " + (note.tags || []).join(", "));
  lines.push("created: " + (note.created || ""));
  lines.push("updated: " + (note.updated || ""));
  lines.push("pinned: " + (note.pinned ? "true" : "false"));
  if (note.trashed) {
    lines.push("trashedFrom: " + (note.trashedFrom || note.notebook || ""));
  }
  /* v1.5: archived files carry where they were archived from, exactly
     the way trashed files carry trashedFrom. Written only for archived
     notes, so live and trashed files keep their earlier front matter. */
  if (note.archived) {
    lines.push("archivedFrom: " + (note.archivedFrom || note.notebook || ""));
  }
  /* v1.2: attachment metadata. Written only when the note actually has
     attachments, so notes without any keep byte identical front matter
     to earlier versions. JSON.stringify never emits a raw newline, which
     keeps the value on one line as the format requires. */
  const atts = sanitizeAttachments(note.attachments);
  if (atts.length) {
    lines.push("attachments: " + JSON.stringify(atts));
  }
  /* v2.11: the note thumbnail is one attachment id (set from the
     image menu's Set as note thumbnail). Written only when set, so
     notes without one keep byte identical front matter. */
  if (note.thumbnail) {
    lines.push("thumbnail: " + note.thumbnail);
  }
  /* v2.35: the note's reminder (Evernote parity): the moment
     it fires at, and the moment it was marked done, as ISO
     stamps. Written only when set, exactly like the thumbnail,
     so a note without a reminder keeps byte identical front
     matter to every earlier build. */
  if (note.reminderAt) {
    lines.push("reminderAt: " + note.reminderAt);
  }
  if (note.reminderDoneAt) {
    lines.push("reminderDoneAt: " + note.reminderDoneAt);
  }
  lines.push("---");
  lines.push("");
  lines.push(note.body || "");
  return lines.join("\n");
}

/* Parse one file back into a note object. The fallback title comes from
   the file name for hand written files with no front matter at all, so a
   user can drop a plain .md file into a notebook folder and it still
   shows up in the app. */
function parseNoteFile(text, sha, fallbackId, trashed, archived) {
  const note = {
    id: fallbackId,
    title: "Untitled note",
    notebook: "",
    tags: [],
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    pinned: false,
    body: "",
    bodyLoaded: true,  /* v2.20: false only for catalog shells */
    previewText: null, /* v2.20: shells carry the catalog preview here */
    attachments: [],   /* v1.2: attachment metadata, see serializeNote */
    thumbnail: null,   /* v2.11: thumbnail attachment id, or null */
    reminderAt: null,  /* v2.35: the reminder moment ISO, or null */
    reminderDoneAt: null, /* v2.35: the done stamp ISO, or null */
    sha: sha || null,
    fileId: null,      /* v2.20: the Drive file id, when a load resolved it */
    trashed: !!trashed,
    trashedFrom: null,
    archived: !!archived,   /* v1.5, mirrors trashed */
    archivedFrom: null      /* v1.5, mirrors trashedFrom */
  };
  const raw = String(text || "");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (match) {
    const meta = {};
    match[1].split(/\r?\n/).forEach(function (line) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
    });
    if (meta.id) { note.id = meta.id; }
    if (meta.title) { note.title = meta.title; }
    if (meta.notebook) { note.notebook = meta.notebook; }
    if (meta.tags) {
      note.tags = meta.tags.split(",").map(function (t) { return t.trim(); })
        .filter(function (t) { return t.length > 0; });
    }
    if (meta.created) { note.created = meta.created; }
    if (meta.updated) { note.updated = meta.updated; }
    note.pinned = meta.pinned === "true";
    if (meta.trashedFrom) { note.trashedFrom = meta.trashedFrom; }
    if (meta.archivedFrom) { note.archivedFrom = meta.archivedFrom; }
    /* v2.11: the thumbnail attachment id, one plain value. */
    if (meta.thumbnail) { note.thumbnail = meta.thumbnail; }
    /* v2.35: the reminder pair. A value that does not parse
       as a date is ignored rather than carried, so a hand
       edited or damaged line degrades to no reminder, the
       same degrade the attachments line uses. */
    if (meta.reminderAt &&
        !isNaN(new Date(meta.reminderAt).getTime())) {
      note.reminderAt = meta.reminderAt;
    }
    if (meta.reminderDoneAt &&
        !isNaN(new Date(meta.reminderDoneAt).getTime())) {
      note.reminderDoneAt = meta.reminderDoneAt;
    }
    /* v1.2: attachment metadata. A malformed line must never break the
       note: it is counted as a warning (surfaced once after load) and the
       note opens with no attachment metadata. */
    if (meta.attachments) {
      try {
        const parsedAtts = JSON.parse(meta.attachments);
        if (!Array.isArray(parsedAtts)) { throw new Error("not an array"); }
        note.attachments = sanitizeAttachments(parsedAtts);
        if (note.attachments.length !== parsedAtts.length) {
          attachmentParseWarnings++;
        }
      } catch (attErr) {
        note.attachments = [];
        attachmentParseWarnings++;
      }
    }
    note.body = raw.slice(match[0].length).replace(/^\s*\n/, "");
  } else {
    note.body = raw;
    const firstLine = htmlToText(raw).slice(0, 60);
    if (firstLine) { note.title = firstLine; }
  }
  if (note.trashed && !note.trashedFrom) {
    note.trashedFrom = note.notebook || "personal";
  }
  if (!note.notebook && note.trashedFrom) { note.notebook = note.trashedFrom; }
  /* v1.5: the same repairs for archived files. Files written before
     archiving existed never reach this code with archived set, so they
     load as ordinary unarchived notes. */
  if (note.archived && !note.archivedFrom) {
    note.archivedFrom = note.notebook || "personal";
  }
  if (!note.notebook && note.archivedFrom) { note.notebook = note.archivedFrom; }
  return note;
}

