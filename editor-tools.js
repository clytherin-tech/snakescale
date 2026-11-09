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
/* ----- v2.1.0: export the open note --------------------------------------
   Three formats from the Export menu in the editor footer. All three
   start from the note as it stands on screen: collectEditor folds the
   live editor back into the note object first, so unsaved typing is
   exported too. */

/* Download a Blob under a file name: the same anchor pattern
   downloadAttachment uses. */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
}

/* The export file name base: the note title through sanitizeFileName
   (the same sanitizer attachment storage names use), with any
   trailing dots trimmed, falling back to "note". */
function exportFileBase(note) {
  const clean = sanitizeFileName(note.title || "Untitled note")
    .replace(/\.+$/, "").trim();
  return clean || "note";
}

function currentExportNote() {
  const note = currentNote();
  if (!note) {
    toast("Open a note to export it.", true);
    return null;
  }
  collectEditor(note);
  return note;
}

/* The body of a note as plain text, line by line. Built for export:
   blocks become lines, list markers survive ("- " for bullets, "1. "
   counting for numbered lists, two spaces of indent per nesting
   level), checklist items become ballot box lines (the U+2610 and
   U+2611 characters), web links keep their address in parentheses,
   note links show their label only, images and files become bracketed
   lines with the attachment name, tables become tab separated rows,
   and code blocks stay literal. Attachment placeholders are resolved
   through the note's attachment records, exactly like hydration. */
function noteBodyToPlainText(html, note) {
  const holder = document.createElement("div");
  holder.innerHTML = html || "";
  const attById = {};
  (note.attachments || []).forEach(function (att) { attById[att.id] = att; });
  const lines = [];
  let cur = "";
  function endLine() { lines.push(cur); cur = ""; }
  function attachmentLine(el) {
    if (cur.trim()) { endLine(); }
    const att = attById[el.getAttribute("data-attachment-id")];
    const name = att ? att.name : "attachment";
    lines.push(att && isImageAttachment(att)
      ? "[Image: " + name + "]"
      : "[Attachment: " + name + "]");
  }
  function inlineNode(node) {
    if (node.nodeType === 3) { cur += node.nodeValue; return; }
    if (node.nodeType !== 1) { return; }
    if (node.classList && node.classList.contains("ss-attachment")) {
      attachmentLine(node);
      return;
    }
    const tag = node.tagName;
    if (tag === "BR") { endLine(); return; }
    if (tag === "INPUT") { return; }
    if (tag === "IMG") {
      cur += "[Image: " + (node.getAttribute("alt") || "image") + "]";
      return;
    }
    if (tag === "A") {
      const start = cur.length;
      node.childNodes.forEach(inlineNode);
      const href = node.getAttribute("href") || "";
      if (/^(https?:|mailto:)/i.test(href) &&
          cur.slice(start).trim() !== href) {
        cur += " (" + href + ")";
      }
      return;
    }
    node.childNodes.forEach(inlineNode);
  }
  function isCheckedItem(li) {
    const box = li.querySelector("input[type=\"checkbox\"]");
    return li.classList.contains("done") ||
      !!(box && (box.checked || box.hasAttribute("checked")));
  }
  function listLines(listEl, depth) {
    const indent = "  ".repeat(depth);
    const ordered = listEl.tagName === "OL";
    const checklist = listEl.classList.contains("ss-checklist") ||
      !!listEl.querySelector(":scope > li input[type=\"checkbox\"]");
    let num = 0;
    Array.prototype.forEach.call(listEl.children, function (li) {
      if (li.tagName !== "LI") { return; }
      /* v2.110.0: a level wrapper is not an item: it
         takes no number and no line of its own, and
         its sub-list renders one level deeper, the
         way the note itself renders it. */
      if (li.classList.contains("ss-level-pad")) {
        Array.prototype.forEach.call(li.children,
          function (child) {
            if (child.tagName === "UL" ||
                child.tagName === "OL") {
              listLines(child, depth + 1);
            }
          });
        return;
      }
      num++;
      let prefix;
      if (checklist) { prefix = isCheckedItem(li) ? "\u2611 " : "\u2610 "; }
      else if (ordered) { prefix = num + ". "; }
      else { prefix = "- "; }
      cur = indent + prefix;
      /* The item's own content goes on the prefixed line; nested
         lists render after it, one level deeper. The checkbox input
         itself contributes nothing (inlineNode skips INPUT). */
      Array.prototype.forEach.call(li.childNodes, function (child) {
        if (child.nodeType === 1 &&
            (child.tagName === "UL" || child.tagName === "OL")) { return; }
        inlineNode(child);
      });
      endLine();
      Array.prototype.forEach.call(li.children, function (child) {
        if (child.tagName === "UL" || child.tagName === "OL") {
          listLines(child, depth + 1);
        }
      });
    });
  }
  function blockNode(node) {
    if (node.nodeType === 3) {
      if (node.nodeValue && node.nodeValue.trim()) {
        cur += node.nodeValue;
        endLine();
      }
      return;
    }
    if (node.nodeType !== 1) { return; }
    if (node.classList && node.classList.contains("ss-attachment")) {
      attachmentLine(node);
      return;
    }
    /* v2.49.0: a tasks block exports as the lines it
       means, generated from live task state at export
       time (the saved body holds only the bare marker,
       which has no text of its own): a Tasks heading and
       one ballot line per linked task. A block with no
       linked tasks contributes no lines. */
    if (node.classList && node.classList.contains("ss-note-tasks")) {
      const taskLines = noteTaskPlainLines(note.id);
      if (taskLines.length) {
        if (cur.trim()) { endLine(); }
        lines.push("Tasks");
        taskLines.forEach(function (line) { lines.push(line); });
      }
      return;
    }
    const tag = node.tagName;
    if (tag === "UL" || tag === "OL") { listLines(node, 0); return; }
    if (tag === "TABLE") {
      node.querySelectorAll("tr").forEach(function (tr) {
        const cells = [];
        tr.querySelectorAll("th, td").forEach(function (cell) {
          cells.push((cell.textContent || "").replace(/\s+/g, " ").trim());
        });
        if (cells.length) { lines.push(cells.join("\t")); }
      });
      return;
    }
    if (tag === "PRE") {
      const text = (node.textContent || "").replace(/\n$/, "");
      text.split("\n").forEach(function (line) { lines.push(line); });
      return;
    }
    if (tag === "HR") { lines.push("---"); return; }
    if (tag === "P" || tag === "DIV" || tag === "BLOCKQUOTE" ||
        tag === "LI" || /^H[1-6]$/.test(tag)) {
      node.childNodes.forEach(inlineNode);
      endLine();
      return;
    }
    /* Anything else at block level: render its children as blocks. */
    node.childNodes.forEach(blockNode);
  }
  holder.childNodes.forEach(blockNode);
  if (cur.trim()) { endLine(); }
  return lines.join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

function exportNoteTxt() {
  const note = currentExportNote();
  if (!note) { return; }
  const text = noteBodyToPlainText(note.body, note);
  const out = (note.title || "Untitled note") + "\n\n" + text + "\n";
  downloadBlob(new Blob([out], { type: "text/plain;charset=utf-8" }),
    exportFileBase(note) + ".txt");
  toast("Exported as text.");
}

/* ----- v2.1.0: Word (.docx) export ---------------------------------------
   A real .docx with no library: the OOXML parts are plain strings,
   and the package is a stored (uncompressed) zip written by hand
   below. word/document.xml is built by walking the note body DOM with
   the same shape as the plain text walker: paragraphs and headings
   become Word paragraphs (headings use the Heading1 to Heading3
   styles from word/styles.xml), runs carry bold, italic, underline,
   and strikethrough, lists become literal prefixed paragraphs with an
   indent (simpler and more reliable than authoring a numbering
   definition, and Word shows the marker as text), checklists become
   lines starting with the ballot box characters U+2610 (unchecked)
   and U+2611 (checked), web links become their text plus the URL in
   parentheses, note links degrade to their label, tables become a
   simple Word table, code becomes monospace runs, and attachments
   become bracketed name lines (no embedded media in this round).
   Tab characters in run text become real <w:tab/> elements (v2.4:
   a literal tab inside <w:t> is not honored by Word). All text
   passes through xmlEscapeText before it enters the XML. */

function xmlEscapeText(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/* One Word run. fmt flags: b bold, i italic, u underline, s
   strikethrough, code monospace (Consolas). Spaces are preserved. */
function docxRun(text, fmt) {
  let rpr = "";
  if (fmt.b) { rpr += "<w:b/>"; }
  if (fmt.i) { rpr += "<w:i/>"; }
  if (fmt.u) { rpr += "<w:u w:val=\"single\"/>"; }
  if (fmt.s) { rpr += "<w:strike/>"; }
  if (fmt.code) {
    rpr += "<w:rFonts w:ascii=\"Consolas\" w:hAnsi=\"Consolas\"/>";
  }
  const open = "<w:r>" + (rpr ? "<w:rPr>" + rpr + "</w:rPr>" : "");
  /* v2.4: the text is split on tab characters and the segments are
     joined by runs holding a real <w:tab/> element. Text without
     tabs produces exactly the single run this function has always
     produced. */
  const segments = String(text).split("\t");
  let out = "";
  segments.forEach(function (segment, i) {
    if (i > 0) { out += "<w:r><w:tab/></w:r>"; }
    if (segment) {
      out += open + "<w:t xml:space=\"preserve\">" +
        xmlEscapeText(segment) + "</w:t></w:r>";
    }
  });
  if (!out) {
    out = open + "<w:t xml:space=\"preserve\"></w:t></w:r>";
  }
  return out;
}

function docxBreakRun() {
  return "<w:r><w:br/></w:r>";
}

/* Collect the runs of an inline subtree into out. Formatting
   accumulates down the tree: b from B and STRONG, i from I and EM, u
   from U, s from S, STRIKE, and DEL, code from CODE, and bold, italic,
   underline, and strikethrough from span inline styles (the editor's
   own formatting spans). Web links append their URL in parentheses;
   note links contribute their label only. */
function docxInlineRuns(node, fmt, out) {
  node.childNodes.forEach(function (child) {
    if (child.nodeType === 3) {
      if (child.nodeValue) { out.push(docxRun(child.nodeValue, fmt)); }
      return;
    }
    if (child.nodeType !== 1) { return; }
    if (child.classList && child.classList.contains("ss-attachment")) {
      return; /* placeholders render as their own block line */
    }
    const tag = child.tagName;
    if (tag === "BR") { out.push(docxBreakRun()); return; }
    if (tag === "INPUT") { return; }
    const next = { b: fmt.b, i: fmt.i, u: fmt.u, s: fmt.s, code: fmt.code };
    if (tag === "B" || tag === "STRONG") { next.b = true; }
    if (tag === "I" || tag === "EM") { next.i = true; }
    if (tag === "U") { next.u = true; }
    if (tag === "S" || tag === "STRIKE" || tag === "DEL") { next.s = true; }
    if (tag === "CODE") { next.code = true; }
    if (tag === "SPAN" && child.style) {
      const wgt = child.style.fontWeight;
      if (wgt === "bold" || wgt === "700" ||
          parseInt(wgt, 10) >= 600) { next.b = true; }
      if (child.style.fontStyle === "italic") { next.i = true; }
      const deco = child.style.textDecoration || "";
      if (deco.indexOf("underline") >= 0) { next.u = true; }
      if (deco.indexOf("line-through") >= 0) { next.s = true; }
    }
    if (tag === "A") {
      docxInlineRuns(child, next, out);
      const href = child.getAttribute("href") || "";
      if (/^(https?:|mailto:)/i.test(href)) {
        out.push(docxRun(" (" + href + ")", fmt));
      }
      return;
    }
    docxInlineRuns(child, next, out);
  });
}

function docxPara(styleId, runsXml, indentTwips) {
  let ppr = "";
  if (styleId) { ppr += "<w:pStyle w:val=\"" + styleId + "\"/>"; }
  if (indentTwips) { ppr += "<w:ind w:left=\"" + indentTwips + "\"/>"; }
  return "<w:p>" + (ppr ? "<w:pPr>" + ppr + "</w:pPr>" : "") +
    runsXml + "</w:p>";
}

function buildWordDocumentXml(note) {
  const holder = document.createElement("div");
  holder.innerHTML = note.body || "";
  const attById = {};
  (note.attachments || []).forEach(function (att) { attById[att.id] = att; });
  const blocks = [];
  /* The note title leads the document, in the Title style. */
  blocks.push(docxPara("Title",
    docxRun(note.title || "Untitled note",
      { b: false, i: false, u: false, s: false, code: false })));
  function runsOf(el) {
    const out = [];
    docxInlineRuns(el,
      { b: false, i: false, u: false, s: false, code: false }, out);
    return out.join("");
  }
  function attachmentPara(el) {
    const att = attById[el.getAttribute("data-attachment-id")];
    const name = att ? att.name : "attachment";
    const label = att && isImageAttachment(att)
      ? "[Image: " + name + "]" : "[Attachment: " + name + "]";
    blocks.push(docxPara(null, docxRun(label,
      { b: false, i: false, u: false, s: false, code: false })));
  }
  function listParas(listEl, depth) {
    const ordered = listEl.tagName === "OL";
    const checklist = listEl.classList.contains("ss-checklist") ||
      !!listEl.querySelector(":scope > li input[type=\"checkbox\"]");
    let num = 0;
    Array.prototype.forEach.call(listEl.children, function (li) {
      if (li.tagName !== "LI") { return; }
      /* v2.110.0: a level wrapper is not an item: it
         takes no number and no paragraph of its own,
         and its sub-list renders one level deeper,
         the way the note itself renders it. */
      if (li.classList.contains("ss-level-pad")) {
        Array.prototype.forEach.call(li.children,
          function (child) {
            if (child.tagName === "UL" ||
                child.tagName === "OL") {
              listParas(child, depth + 1);
            }
          });
        return;
      }
      num++;
      let prefix;
      if (checklist) {
        const box = li.querySelector("input[type=\"checkbox\"]");
        const checked = li.classList.contains("done") ||
          !!(box && (box.checked || box.hasAttribute("checked")));
        prefix = checked ? "\u2611 " : "\u2610 ";
      } else if (ordered) { prefix = num + ". "; }
      else { prefix = "\u2022 "; }
      /* The item's own runs, skipping nested lists (they follow as
         their own paragraphs, one indent deeper). */
      const itemHolder = document.createElement("div");
      Array.prototype.forEach.call(li.childNodes, function (child) {
        if (child.nodeType === 1 &&
            (child.tagName === "UL" || child.tagName === "OL")) { return; }
        itemHolder.appendChild(child.cloneNode(true));
      });
      const emptyFmt = { b: false, i: false, u: false, s: false, code: false };
      blocks.push(docxPara(null,
        docxRun(prefix, emptyFmt) + runsOf(itemHolder), depth * 360));
      Array.prototype.forEach.call(li.children, function (child) {
        if (child.tagName === "UL" || child.tagName === "OL") {
          listParas(child, depth + 1);
        }
      });
    });
  }
  function tableXml(table) {
    let rows = "";
    table.querySelectorAll("tr").forEach(function (tr) {
      let cells = "";
      tr.querySelectorAll("th, td").forEach(function (cell) {
        cells += "<w:tc><w:tcPr><w:tcW w:w=\"0\" w:type=\"auto\"/></w:tcPr>" +
          docxPara(null, runsOf(cell)) + "</w:tc>";
      });
      rows += "<w:tr>" + cells + "</w:tr>";
    });
    const border = " w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"BFBFBF\"";
    return "<w:tbl><w:tblPr><w:tblW w:w=\"0\" w:type=\"auto\"/>" +
      "<w:tblBorders>" +
      "<w:top" + border + "/><w:left" + border + "/>" +
      "<w:bottom" + border + "/><w:right" + border + "/>" +
      "<w:insideH" + border + "/><w:insideV" + border + "/>" +
      "</w:tblBorders></w:tblPr>" + rows + "</w:tbl>";
  }
  function blockNode(node) {
    if (node.nodeType === 3) {
      if (node.nodeValue && node.nodeValue.trim()) {
        blocks.push(docxPara(null, docxRun(node.nodeValue.trim(),
          { b: false, i: false, u: false, s: false, code: false })));
      }
      return;
    }
    if (node.nodeType !== 1) { return; }
    if (node.classList && node.classList.contains("ss-attachment")) {
      attachmentPara(node);
      return;
    }
    /* v2.49.0: a tasks block becomes the lines it means,
       generated from live task state like the text
       export: a bold Tasks paragraph and one paragraph
       per linked task. A block with no linked tasks
       contributes no paragraphs. */
    if (node.classList && node.classList.contains("ss-note-tasks")) {
      const taskLines = noteTaskPlainLines(note.id);
      if (taskLines.length) {
        const plainFmt = { b: false, i: false, u: false,
          s: false, code: false };
        blocks.push(docxPara(null, docxRun("Tasks",
          { b: true, i: false, u: false, s: false, code: false })));
        taskLines.forEach(function (line) {
          blocks.push(docxPara(null, docxRun(line, plainFmt)));
        });
      }
      return;
    }
    const tag = node.tagName;
    if (tag === "P" || tag === "LI") {
      blocks.push(docxPara(null, runsOf(node)));
    } else if (tag === "DIV") {
      /* A div flattens its inline content into one paragraph. */
      blocks.push(docxPara(null, runsOf(node)));
    } else if (tag === "H1" || tag === "H2" || tag === "H3") {
      blocks.push(docxPara("Heading" + tag.slice(1), runsOf(node)));
    } else if (tag === "H4" || tag === "H5" || tag === "H6") {
      blocks.push(docxPara("Heading3", runsOf(node)));
    } else if (tag === "BLOCKQUOTE") {
      blocks.push(docxPara("Quote", runsOf(node)));
    } else if (tag === "UL" || tag === "OL") {
      listParas(node, 0);
    } else if (tag === "TABLE") {
      blocks.push(tableXml(node));
    } else if (tag === "PRE") {
      const text = (node.textContent || "").replace(/\n$/, "");
      text.split("\n").forEach(function (line) {
        blocks.push(docxPara(null, docxRun(line,
          { b: false, i: false, u: false, s: false, code: true })));
      });
    } else if (tag === "HR") {
      blocks.push("<w:p><w:pPr><w:pBdr>" +
        "<w:bottom w:val=\"single\" w:sz=\"6\" w:space=\"1\" w:color=\"BFBFBF\"/>" +
        "</w:pBdr></w:pPr></w:p>");
    } else {
      node.childNodes.forEach(blockNode);
    }
  }
  holder.childNodes.forEach(blockNode);
  return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" +
    "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">" +
    "<w:body>" + blocks.join("") +
    "<w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\"/>" +
    "<w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" " +
    "w:left=\"1440\" w:header=\"720\" w:footer=\"720\" w:gutter=\"0\"/>" +
    "</w:sectPr></w:body></w:document>";
}

/* The static OOXML parts: content types, the package relationship to
   the document, the document's relationship to its styles, and a
   minimal style set (defaults plus Normal, Title, Heading1 to
   Heading3, and Quote) so Word opens the file without complaint. */
const WORD_CONTENT_TYPES_XML =
  "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" +
  "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
  "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
  "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
  "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>" +
  "<Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>" +
  "</Types>";
const WORD_ROOT_RELS_XML =
  "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" +
  "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
  "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>" +
  "</Relationships>";
const WORD_DOC_RELS_XML =
  "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" +
  "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
  "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>" +
  "</Relationships>";
const WORD_STYLES_XML =
  "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" +
  "<w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">" +
  "<w:docDefaults><w:rPrDefault><w:rPr>" +
  "<w:rFonts w:ascii=\"Calibri\" w:hAnsi=\"Calibri\" w:cs=\"Calibri\"/>" +
  "<w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/>" +
  "</w:rPr></w:rPrDefault></w:docDefaults>" +
  "<w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\">" +
  "<w:name w:val=\"Normal\"/><w:qFormat/></w:style>" +
  "<w:style w:type=\"paragraph\" w:styleId=\"Title\">" +
  "<w:name w:val=\"Title\"/><w:basedOn w:val=\"Normal\"/><w:qFormat/>" +
  "<w:rPr><w:b/><w:sz w:val=\"52\"/></w:rPr></w:style>" +
  "<w:style w:type=\"paragraph\" w:styleId=\"Heading1\">" +
  "<w:name w:val=\"heading 1\"/><w:basedOn w:val=\"Normal\"/><w:qFormat/>" +
  "<w:rPr><w:b/><w:sz w:val=\"32\"/></w:rPr></w:style>" +
  "<w:style w:type=\"paragraph\" w:styleId=\"Heading2\">" +
  "<w:name w:val=\"heading 2\"/><w:basedOn w:val=\"Normal\"/><w:qFormat/>" +
  "<w:rPr><w:b/><w:sz w:val=\"28\"/></w:rPr></w:style>" +
  "<w:style w:type=\"paragraph\" w:styleId=\"Heading3\">" +
  "<w:name w:val=\"heading 3\"/><w:basedOn w:val=\"Normal\"/><w:qFormat/>" +
  "<w:rPr><w:b/><w:sz w:val=\"24\"/></w:rPr></w:style>" +
  "<w:style w:type=\"paragraph\" w:styleId=\"Quote\">" +
  "<w:name w:val=\"Quote\"/><w:basedOn w:val=\"Normal\"/><w:qFormat/>" +
  "<w:rPr><w:i/><w:color w:val=\"595959\"/></w:rPr></w:style>" +
  "</w:styles>";

/* CRC32 (the standard zip polynomial), computed once into a table. */
const ZIP_CRC_TABLE = (function () {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function zipCrc32(bytes) {
  let crc = -1;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ ZIP_CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
  }
  return (crc ^ -1) >>> 0;
}

/* Write entries as a stored (method 0, uncompressed) zip: a local
   header and the raw bytes per entry, then the central directory,
   then the end record. Stored entries keep this writer small, every
   unzipper reads them, and Word accepts them. The DOS date is a
   fixed 2026-10-20 so the bytes are deterministic, and file names
   are flagged UTF-8. */
function buildStoredZip(entries) {
  const encoder = new TextEncoder();
  const dosDate = ((2026 - 1980) << 9) | (10 << 5) | 20;
  const chunks = [];
  const central = [];
  let offset = 0;
  entries.forEach(function (entry) {
    const nameBytes = encoder.encode(entry.name);
    const data = typeof entry.data === "string"
      ? encoder.encode(entry.data) : entry.data;
    const crc = zipCrc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, 0, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);
    cen.setUint16(12, 0, true);
    cen.setUint16(14, dosDate, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, nameBytes.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  });
  let centralSize = 0;
  central.forEach(function (c) { centralSize += c.length; });
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = chunks.concat(central).concat([new Uint8Array(end.buffer)]);
  let total = 0;
  all.forEach(function (c) { total += c.length; });
  const out = new Uint8Array(total);
  let at = 0;
  all.forEach(function (c) { out.set(c, at); at += c.length; });
  return out;
}

function buildDocxBytes(note) {
  return buildStoredZip([
    { name: "[Content_Types].xml", data: WORD_CONTENT_TYPES_XML },
    { name: "_rels/.rels", data: WORD_ROOT_RELS_XML },
    { name: "word/document.xml", data: buildWordDocumentXml(note) },
    { name: "word/styles.xml", data: WORD_STYLES_XML },
    { name: "word/_rels/document.xml.rels", data: WORD_DOC_RELS_XML }
  ]);
}

function exportNoteDocx() {
  const note = currentExportNote();
  if (!note) { return; }
  const bytes = buildDocxBytes(note);
  downloadBlob(new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  }), exportFileBase(note) + ".docx");
  toast("Exported as a Word document.");
}

/* ----- v2.1.0: PDF export through a print view ---------------------------
   The print document is generated by ONE named function that returns
   the whole standalone HTML string, so it is unit testable and the
   print view never depends on the app window's live state. The body
   HTML passed in comes from currentPrintableBodyHtml. The generated
   document prints itself on load; the user picks Save as PDF in the
   browser's print dialog. */
function buildPrintDocument(note, bodyHtml) {
  const title = escapeHtml(note.title || "Untitled note");
  /* v2.3: a table filter is an editor view aid, never a print
     setting, so rows it hides in the editor (class ss-filtered-out)
     print like every other row: the class is stripped from the body
     copy that goes into the print document. The note itself is not
     touched. */
  const printHolder = document.createElement("div");
  printHolder.innerHTML = bodyHtml || "";
  printHolder.querySelectorAll(".ss-filtered-out").forEach(function (el) {
    el.classList.remove("ss-filtered-out");
    if (!el.classList.length) { el.removeAttribute("class"); }
  });
  /* v2.48.0: a fold is a screen state for reading, never
     a way to leave content out of a printed copy, so the
     runtime hidden class is stripped from the print copy
     the same way (every folded section prints expanded),
     and any fold toggle in the copy goes with it. The
     note itself is not touched. */
  printHolder.querySelectorAll(".ss-fold-hidden").forEach(function (el) {
    el.classList.remove("ss-fold-hidden");
    if (!el.classList.length) { el.removeAttribute("class"); }
  });
  printHolder.querySelectorAll(".ss-fold-toggle").forEach(function (el) {
    el.remove();
  });
  /* v2.9: the body the print view receives is a clone of the LIVE
     body, faces and wrapped originals included. Faces are editor
     presentation and would double every faced link's text on
     paper, so they are stripped (and the originals unwrapped)
     here, leaving the plain anchors, whose own text and address
     are what print has always shown. */
  /* v2.49.0: a tasks block prints as what it means, not
     as its screen furniture: the rendered rows, their
     checkboxes, and the Add button are the editor's
     window, so the print copy replaces each block with a
     plain list generated from live task state at print
     time (a Tasks heading and one ballot line per linked
     task, the noteTaskPlainLine form). A block with no
     linked tasks prints as nothing. The note itself is
     not touched. */
  printHolder.querySelectorAll(".ss-note-tasks").forEach(function (el) {
    const lines = noteTaskPlainLines(note.id);
    if (!lines.length) { el.remove(); return; }
    const wrap = document.createElement("div");
    const head = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = "Tasks";
    head.appendChild(strong);
    wrap.appendChild(head);
    const list = document.createElement("ul");
    lines.forEach(function (line) {
      const li = document.createElement("li");
      li.textContent = line;
      list.appendChild(li);
    });
    wrap.appendChild(list);
    el.replaceWith(wrap);
  });
  stripLinkFaces(printHolder);
  /* v2.11: a Title mode image prints as the image (see
     stripImageTitleFaces); its runtime bar never reaches paper. */
  stripImageTitleFaces(printHolder);
  const cleanBodyHtml = printHolder.innerHTML;
  return "<!DOCTYPE html>\n<html><head><meta charset=\"UTF-8\">" +
    "<title>" + title + "</title>" +
    "<style>" +
    "body{font-family:Georgia,'Times New Roman',serif;color:#10231A;" +
    "max-width:720px;margin:40px auto;padding:0 24px;line-height:1.55;}" +
    "h1{font-size:26px;margin:0 0 18px;}" +
    "h2{font-size:21px;}h3{font-size:17px;}" +
    "img{max-width:100%;height:auto;}" +
    "pre{background:#F0F3EC;border:1px solid #C9D6C9;border-radius:8px;" +
    "padding:10px 12px;overflow-x:auto;font-size:13px;}" +
    "code{font-family:Consolas,Menlo,monospace;}" +
    "table{border-collapse:collapse;width:100%;}" +
    "table.ss-sized{table-layout:fixed;}" +
    "th,td{border:1px solid #C9D6C9;padding:6px 10px;text-align:left;}" +
    "th{background:#EFF4EE;}" +
    "a{color:#14532D;}" +
    "a.ss-note-link{color:inherit;text-decoration:none;}" +
    "ul{list-style-type:disc;}" +
    ":is(ul,ol) ul{list-style-type:circle;}" +
    ":is(ul,ol) :is(ul,ol) ul{list-style-type:square;}" +
    ":is(ul,ol) :is(ul,ol) :is(ul,ol) ul{" +
    "list-style-type:disc;}" +
    "ol{list-style-type:decimal;}" +
    ":is(ul,ol) ol{list-style-type:lower-alpha;}" +
    ":is(ul,ol) :is(ul,ol) ol{" +
    "list-style-type:lower-roman;}" +
    ":is(ul,ol) :is(ul,ol) :is(ul,ol) ol{" +
    "list-style-type:decimal;}" +
    ":is(ul,ol) :is(ul,ol) :is(ul,ol) :is(ul,ol) ul{" +
    "list-style-type:circle;}" +
    ":is(ul,ol) :is(ul,ol) :is(ul,ol) :is(ul,ol) " +
    ":is(ul,ol) ul{list-style-type:square;}" +
    ":is(ul,ol) :is(ul,ol) :is(ul,ol) :is(ul,ol) " +
    ":is(ul,ol) :is(ul,ol) ul{list-style-type:disc;}" +
    ":is(ul,ol) :is(ul,ol) :is(ul,ol) :is(ul,ol) " +
    ":is(ul,ol) :is(ul,ol) :is(ul,ol) ul{" +
    "list-style-type:circle;}" +
    ":is(ul,ol) :is(ul,ol) :is(ul,ol) :is(ul,ol) " +
    ":is(ul,ol) :is(ul,ol) :is(ul,ol) :is(ul,ol) ul{" +
    "list-style-type:square;}" +
    ":is(ul,ol) :is(ul,ol) :is(ul,ol) :is(ul,ol) ol{" +
    "list-style-type:lower-alpha;}" +
    ":is(ul,ol) :is(ul,ol) :is(ul,ol) :is(ul,ol) " +
    ":is(ul,ol) ol{list-style-type:lower-roman;}" +
    ":is(ul,ol) :is(ul,ol) :is(ul,ol) :is(ul,ol) " +
    ":is(ul,ol) :is(ul,ol) ol{list-style-type:decimal;}" +
    ":is(ul,ol) :is(ul,ol) :is(ul,ol) :is(ul,ol) " +
    ":is(ul,ol) :is(ul,ol) :is(ul,ol) ol{" +
    "list-style-type:lower-alpha;}" +
    ":is(ul,ol) :is(ul,ol) :is(ul,ol) :is(ul,ol) " +
    ":is(ul,ol) :is(ul,ol) :is(ul,ol) :is(ul,ol) ol{" +
    "list-style-type:lower-roman;}" +
    "li.ss-level-pad{display:contents;}" +
    "ol.ss-num-decimal{list-style-type:decimal;}" +
    "ol.ss-num-upper-alpha{list-style-type:upper-alpha;}" +
    "ol.ss-num-lower-alpha{list-style-type:lower-alpha;}" +
    "ol.ss-num-upper-roman{list-style-type:upper-roman;}" +
    "ol.ss-num-lower-roman{list-style-type:lower-roman;}" +
    "ul.ss-checklist{list-style:none;}" +
    "ul.ss-checklist>li{list-style:none;}" +
    ".ss-attachment{border:1px solid #C9D6C9;border-radius:8px;" +
    "padding:10px 12px;margin:12px 0;}" +
    "@media print{body{margin:0 auto;}}" +
    "</style></head><body>" +
    "<h1>" + title + "</h1>" +
    cleanBodyHtml +
    "<script>window.addEventListener('load',function(){" +
    "setTimeout(function(){window.print();},60);});</scr" + "ipt>" +
    "</body></html>";
}

/* A clone of the live note body for the print view. Images keep the
   sources hydration gave them (blob URLs resolve in the print window
   because it is same origin), while editor only chrome is stripped:
   attachment action buttons and menus, resize grips, and previews of
   not yet loaded files never belong on paper. */
function currentPrintableBodyHtml() {
  const bodyEl = document.getElementById("noteBody");
  const clone = bodyEl.cloneNode(true);
  clone.querySelectorAll(
    ".ss-att-actions, .ss-att-menu-btn, .ss-grip, .ss-att-preview, button"
  ).forEach(function (el) { el.remove(); });
  return clone.innerHTML;
}

function exportNotePdf() {
  const note = currentExportNote();
  if (!note) { return; }
  const win = window.open("", "_blank");
  if (!win) {
    toast("The print window was blocked by the browser. Allow popups " +
      "for this site, then choose Export, PDF again, and pick " +
      "Save as PDF in the print dialog.", true);
    return;
  }
  win.document.open();
  win.document.write(buildPrintDocument(note, currentPrintableBodyHtml()));
  win.document.close();
  try { win.focus(); } catch (err) { /* focus is best effort */ }
}

/* ----- v2.1.0: import notes ----------------------------------------------
   The Import button in the notes list toolbar opens a file picker
   (.txt, .docx, .pdf; multiple files). Every file becomes a note in
   the current notebook; in the All Notes, Pinned, tag, Trash, and
   Archive views the default notebook is used, the same fallback the
   toolbar New Note button uses. Each note is created through the
   instant path the New Note button uses: it exists locally at once
   and its upload runs in the background. A failing file never stops
   the batch: every failure is named in the closing summary toast. */

/* Blob reads with a FileReader fallback, so the import works in any
   browser, not only ones with the newer Blob text methods. */
function readBlobText(blob) {
  if (typeof blob.text === "function") { return blob.text(); }
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () { resolve(String(reader.result || "")); };
    reader.onerror = function () {
      reject(reader.error || new Error("the file could not be read"));
    };
    reader.readAsText(blob);
  });
}

function readBlobArrayBuffer(blob) {
  if (typeof blob.arrayBuffer === "function") { return blob.arrayBuffer(); }
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = function () {
      reject(reader.error || new Error("the file could not be read"));
    };
    reader.readAsArrayBuffer(blob);
  });
}

function importTargetNotebookSlug() {
  if (state.view.kind === "notebook") { return state.view.value; }
  /* v2.72: away from a notebook view the import lands in
     the default notebook (the first one while none is
     set), the fallback the header above names. */
  return fallbackNotebookSlug();
}

function titleFromFileName(name) {
  const base = String(name || "Imported note")
    .replace(/\.[^.]*$/, "").trim();
  return base || "Imported note";
}

/* Create one imported note instantly, exactly like the toolbar New
   Note does: local first (unshift, cache, render), upload in the
   background as a fresh note (no conflict check against a file that
   cannot exist yet), cache again once its file id lands.
   v2.4.1: a caller whose note is not finished yet passes
   options.holdSave and starts the save itself once the note is
   complete. The Word import is that caller: its body already
   carries image placeholders whose attachment records only exist
   after the uploads finish, so saving at creation would persist
   a note whose placeholders have no records, and anything that
   rendered that version (most simply, the user opening the note
   from the list while the uploads were still running) showed
   every image as a missing details block. Holding the save
   means the first version ever persisted is the finished one. */
function createImportedNote(notebookSlug, title, bodyHtml, options) {
  const note = makeNote(notebookSlug, title, bodyHtml);
  state.notes.unshift(note);
  saveCache();
  renderAll();
  if (!options || !options.holdSave) {
    startImportedNoteSave(note, title);
  }
  return note;
}

/* The create save of an imported note, exactly as it has always
   run: a fresh write with no conflict check (the file cannot
   exist yet), the cache refreshed when it lands, and an honest
   toast when the store cannot be reached (the note text is
   queued by the save itself in that case, records included).
   v2.4.1: extracted from createImportedNote so the Word import
   can start the identical save after its image uploads finish;
   see importFiles. */
function startImportedNoteSave(note, title) {
  saveNoteToRepo(note, { skipConflictCheck: true, fresh: true })
    .then(function () { saveCache(); })
    .catch(function (err) {
      toast("Note \"" + title + "\" was imported and saved on this " +
        "device, but its upload failed: " + err.message, true);
    });
}

/* Plain text to note body HTML: paragraphs split on blank lines,
   single newlines become line breaks inside the paragraph, and every
   character is escaped before it becomes markup. */
function textToNoteBodyHtml(text) {
  const normalized = String(text || "").replace(/\r\n?/g, "\n");
  const paras = normalized.split(/\n\s*\n/)
    .map(function (p) { return p.trim(); })
    .filter(function (p) { return p.length; });
  if (!paras.length) { return "<p><br></p>"; }
  return paras.map(function (p) {
    return "<p>" + escapeHtml(p).replace(/\n/g, "<br>") + "</p>";
  }).join("");
}

/* Read a zip into a name to bytes map. Both header passes are parsed
   by hand: the central directory gives the entry list, and each
   entry's local header gives where its data actually starts. Stored
   entries are read directly; deflated entries are inflated with the
   browser's DecompressionStream("deflate-raw"). When that API is
   unavailable, a deflated entry fails with a clear error while the
   rest of the batch continues. Scope: single disk zips without zip64,
   which covers .docx files, ours and Word's alike. */
async function readZipEntries(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  let eocd = -1;
  const scanFloor = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= scanFloor; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) { throw new Error("not a valid zip file"); }
  const count = view.getUint16(eocd + 10, true);
  let off = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (off + 46 > bytes.length ||
        view.getUint32(off, true) !== 0x02014b50) { break; }
    const method = view.getUint16(off + 10, true);
    const compSize = view.getUint32(off + 20, true);
    const nameLen = view.getUint16(off + 28, true);
    const extraLen = view.getUint16(off + 30, true);
    const commentLen = view.getUint16(off + 32, true);
    const localOff = view.getUint32(off + 42, true);
    const name = decoder.decode(
      bytes.subarray(off + 46, off + 46 + nameLen));
    if (localOff + 30 <= bytes.length &&
        view.getUint32(localOff, true) === 0x04034b50) {
      const localNameLen = view.getUint16(localOff + 26, true);
      const localExtraLen = view.getUint16(localOff + 28, true);
      const start = localOff + 30 + localNameLen + localExtraLen;
      const compressed = bytes.subarray(start, start + compSize);
      if (method === 0) {
        entries.set(name, compressed.slice());
      } else if (method === 8) {
        entries.set(name, await inflateRawBytes(compressed));
      } else {
        throw new Error("unsupported zip compression method " + method);
      }
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRawBytes(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("this browser cannot open compressed .docx files " +
      "(no DecompressionStream support)");
  }
  const source = new ReadableStream({
    start: function (controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  });
  const stream = source.pipeThrough(new DecompressionStream("deflate-raw"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

/* word/document.xml to editor HTML. Scope, stated honestly: the
   subset our own exporter writes, plus typical simple Word files.
   Paragraphs, runs with bold and italic (underline, strikethrough,
   and monospace runs are kept too), the Heading1 to Heading3 and
   Title styles, simple lists (numbering definition paragraphs, and
   the literal bullet, number, and ballot box prefixes our exporter
   writes, regrouped into real lists), simple tables, and hyperlinks
   when the relationships part resolves them. Embedded images are
   claimed when the caller passes an image context
   (docxFileToNoteParts does): a drawing or legacy picture inside a
   run becomes an attachment placeholder exactly where it sits.
   Anything fancier (text boxes, fields, tracked changes) is
   skipped, never fatal. A Title paragraph whose text equals the
   note title (from
   the file name) is dropped: our exporter writes the title into the
   document, and it should not come back as a body heading. */
function docxXmlToHtml(xmlText, relsXmlText, expectedTitle, imageCtx) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (!doc || !doc.documentElement ||
      doc.documentElement.localName === "parsererror" ||
      doc.querySelector("parsererror")) {
    throw new Error("the file's document.xml could not be parsed");
  }
  const rels = {};
  if (relsXmlText) {
    const relDoc = new DOMParser().parseFromString(relsXmlText, "application/xml");
    Array.prototype.forEach.call(
      relDoc.getElementsByTagName("Relationship"), function (rel) {
        rels[rel.getAttribute("Id")] = rel.getAttribute("Target");
      });
  }
  function kids(el, localName) {
    return Array.prototype.filter.call(el.children, function (c) {
      return c.localName === localName;
    });
  }
  function firstKid(el, localName) {
    const found = kids(el, localName);
    return found.length ? found[0] : null;
  }
  function runFlag(rPr, name) {
    if (!rPr) { return false; }
    const el = firstKid(rPr, name);
    if (!el) { return false; }
    const v = el.getAttribute("w:val");
    return v !== "false" && v !== "0" && v !== "off";
  }
  /* One run's text under its formatting, the exact wrapping this
     converter has always applied. v2.4: a tab character in the
     text becomes the editor's tab span (span.ss-tab, the same
     shape the Tab key inserts), so a Word tab survives as a tab
     instead of collapsing to a space. */
  function formatRunText(text, rPr, code) {
    let html = escapeHtml(text).replace(/\n/g, "<br>")
      .replace(/\t/g, "<span class=\"ss-tab\">\t</span>");
    if (code) {
      return "<code class=\"ss-inline-code\">" + html + "</code>";
    }
    if (runFlag(rPr, "strike")) { html = "<s>" + html + "</s>"; }
    if (runFlag(rPr, "u")) { html = "<u>" + html + "</u>"; }
    if (runFlag(rPr, "i")) { html = "<em>" + html + "</em>"; }
    if (runFlag(rPr, "b")) { html = "<strong>" + html + "</strong>"; }
    return html;
  }
  /* The first descendant element with a local name, depth first.
     The converter matches on localName throughout (prefix free),
     and image parts are found the same way. */
  function descendantByLocal(el, name) {
    let found = null;
    (function walk(node) {
      const kids = node.children || [];
      for (let i = 0; i < kids.length && !found; i++) {
        if (kids[i].localName === name) { found = kids[i]; }
        else { walk(kids[i]); }
      }
    })(el);
    return found;
  }
  /* v2.4: an image reference inside a run: a DrawingML drawing
     (a:blip r:embed) or a legacy VML picture (v:imagedata r:id).
     Resolves the relationship to its package part, reads Word's
     display width from the drawing extent when one is present
     (9525 EMU per pixel, capped at the reading column by the
     importer), claims the part through the image context, and
     returns the placeholder that stands in the body for it.
     Without an image context (docxFileToHtml's plain conversion),
     or when anything fails to resolve, the image is skipped
     exactly as before v2.4. */
  function imagePlaceholderFor(part) {
    if (!imageCtx) { return ""; }
    const blip = descendantByLocal(part, "blip");
    let rid = blip ? (blip.getAttribute("r:embed") ||
      blip.getAttribute("embed")) : null;
    if (!rid) {
      const imagedata = descendantByLocal(part, "imagedata");
      if (imagedata) {
        rid = imagedata.getAttribute("r:id") ||
          imagedata.getAttribute("id");
      }
    }
    if (!rid) { return ""; }
    const target = rels[rid];
    if (!target) { return ""; }
    let entryName = String(target).replace(/\\/g, "/");
    if (entryName.charAt(0) === "/") { entryName = entryName.slice(1); }
    if (entryName.indexOf("word/") !== 0) {
      entryName = "word/" + entryName;
    }
    let widthPx = 0;
    const extent = descendantByLocal(part, "extent") ||
      descendantByLocal(part, "ext");
    if (extent) {
      const cx = parseInt(extent.getAttribute("cx") || "0", 10);
      if (cx > 0) { widthPx = Math.round(cx / 9525); }
    }
    if (widthPx > IMPORT_IMAGE_MAX_WIDTH_PX) {
      widthPx = IMPORT_IMAGE_MAX_WIDTH_PX;
    }
    const rec = imageCtx.registerImage(entryName);
    if (!rec) { return ""; }
    return importedImagePlaceholderHtml(rec, widthPx);
  }
  function runHtml(r) {
    const rPr = firstKid(r, "rPr");
    let code = false;
    if (rPr) {
      const fonts = firstKid(rPr, "rFonts");
      const fontName = fonts
        ? (fonts.getAttribute("w:ascii") || "") : "";
      code = /consolas|courier|mono/i.test(fontName);
    }
    /* The run's children are converted in order: text accumulates
       and is formatted as one piece (as it always was), and an
       image reference flushes the text ahead of it and stands in
       the flow exactly where the document puts it. */
    let html = "";
    let text = "";
    function flush() {
      if (text) { html += formatRunText(text, rPr, code); text = ""; }
    }
    Array.prototype.forEach.call(r.children, function (part) {
      if (part.localName === "t") { text += part.textContent; }
      else if (part.localName === "br" || part.localName === "cr") {
        text += "\n";
      } else if (part.localName === "tab") { text += "\t"; }
      else if (part.localName === "drawing" ||
               part.localName === "pict") {
        const placeholder = imagePlaceholderFor(part);
        if (placeholder) { flush(); html += placeholder; }
      }
    });
    flush();
    return html;
  }
  function inlineHtml(container) {
    let html = "";
    Array.prototype.forEach.call(container.children, function (child) {
      if (child.localName === "r") {
        html += runHtml(child);
      } else if (child.localName === "hyperlink") {
        const inner = inlineHtml(child);
        const rid = child.getAttribute("r:id");
        const target = rid ? rels[rid] : null;
        if (target && /^https?:/i.test(target)) {
          html += "<a href=\"" + escapeHtml(target) + "\">" +
            inner + "</a>";
        } else {
          html += inner;
        }
      }
    });
    return html;
  }
  function plainTextOf(p) {
    let text = "";
    Array.prototype.forEach.call(p.getElementsByTagName("w:t"),
      function (t) { text += t.textContent; });
    return text;
  }
  function stripTextPrefix(p, count) {
    let left = count;
    const ts = p.getElementsByTagName("w:t");
    for (let i = 0; i < ts.length && left > 0; i++) {
      const take = Math.min(left, ts[i].textContent.length);
      ts[i].textContent = ts[i].textContent.slice(take);
      left -= take;
    }
  }
  const out = [];
  let openListKind = null;
  let titleSeen = false;
  function closeList() {
    if (openListKind) {
      out.push(openListKind === "ol" ? "</ol>" : "</ul>");
      openListKind = null;
    }
  }
  function ensureList(kind) {
    if (openListKind !== kind) {
      closeList();
      out.push(kind === "ol" ? "<ol>"
        : (kind === "checklist" ? "<ul class=\"ss-checklist\">" : "<ul>"));
      openListKind = kind;
    }
  }
  function tableHtml(tbl) {
    let rowsHtml = "";
    kids(tbl, "tr").forEach(function (tr) {
      let cells = "";
      kids(tr, "tc").forEach(function (tc) {
        const cellParas = kids(tc, "p").map(function (p) {
          return inlineHtml(p);
        });
        cells += "<td>" + (cellParas.join("<br>") || "<br>") + "</td>";
      });
      rowsHtml += "<tr>" + cells + "</tr>";
    });
    return "<table class=\"ss-table\"><tbody>" + rowsHtml +
      "</tbody></table>";
  }
  function paraBlock(p) {
    const pPr = firstKid(p, "pPr");
    let styleId = "";
    let hasNumPr = false;
    if (pPr) {
      const pStyle = firstKid(pPr, "pStyle");
      styleId = pStyle ? (pStyle.getAttribute("w:val") || "") : "";
      hasNumPr = !!firstKid(pPr, "numPr");
    }
    const styleKey = styleId.toLowerCase().replace(/[\s_]/g, "");
    if (styleKey === "title") {
      if (!titleSeen && expectedTitle &&
          plainTextOf(p).trim() === expectedTitle.trim()) {
        titleSeen = true;
        return; /* the file name already gave the note its title */
      }
      closeList();
      out.push("<h1>" + (inlineHtml(p) || "<br>") + "</h1>");
      return;
    }
    if (styleKey === "heading1" || styleKey === "heading2" ||
        styleKey === "heading3") {
      closeList();
      const tag = "h" + styleKey.slice(-1);
      out.push("<" + tag + ">" + (inlineHtml(p) || "<br>") +
        "</" + tag + ">");
      return;
    }
    if (styleKey === "quote") {
      closeList();
      out.push("<blockquote>" + (inlineHtml(p) || "<br>") +
        "</blockquote>");
      return;
    }
    const text = plainTextOf(p);
    let kind = null;
    let prefixLen = 0;
    let checked = false;
    if (text.indexOf("\u2611 ") === 0) {
      kind = "checklist"; prefixLen = 2; checked = true;
    } else if (text.indexOf("\u2610 ") === 0) {
      kind = "checklist"; prefixLen = 2;
    } else if (text.indexOf("\u2022 ") === 0) {
      kind = "ul"; prefixLen = 2;
    } else {
      const m = text.match(/^(\d+)[.)]\s/);
      if (m) { kind = "ol"; prefixLen = m[0].length; }
    }
    if (!kind && hasNumPr) { kind = "ul"; }
    if (kind) {
      if (prefixLen) { stripTextPrefix(p, prefixLen); }
      ensureList(kind);
      const inner = inlineHtml(p);
      if (kind === "checklist") {
        out.push("<li" + (checked ? " class=\"done\"" : "") + ">" +
          "<input type=\"checkbox\"" + (checked ? " checked" : "") + ">" +
          inner + "</li>");
      } else {
        out.push("<li>" + (inner || "<br>") + "</li>");
      }
      return;
    }
    closeList();
    const inner = inlineHtml(p);
    const chunks = inner.split(
      /(<(?:figure|div) class="ss-attachment"[^>]*><\/(?:figure|div)>)/g);
    if (chunks.length > 1) {
      /* v2.4: a paragraph carrying imported image placeholders. A
         figure inside a <p> is not valid nesting (the browser
         would tear the paragraph apart at render and strand its
         text), so the paragraph is emitted as a sequence in
         document order: its text runs as paragraphs of their own,
         each placeholder standing alone as the block it is. */
      chunks.forEach(function (chunk) {
        if (!chunk) { return; }
        if (/^<(?:figure|div) class="ss-attachment"/.test(chunk)) {
          out.push(chunk);
        } else {
          out.push("<p>" + chunk + "</p>");
        }
      });
      return;
    }
    out.push("<p>" + (inner || "<br>") + "</p>");
  }
  const bodyEl = firstKid(doc.documentElement, "body") ||
    doc.documentElement;
  Array.prototype.forEach.call(bodyEl.children, function (child) {
    if (child.localName === "p") { paraBlock(child); }
    else if (child.localName === "tbl") {
      closeList();
      out.push(tableHtml(child));
    }
  });
  closeList();
  if (!out.length) { return "<p><br></p>"; }
  return out.join("");
}

async function docxFileToHtml(arrayBuffer, expectedTitle) {
  const entries = await readZipEntries(arrayBuffer);
  const docEntry = entries.get("word/document.xml");
  if (!docEntry) {
    throw new Error("word/document.xml not found in the file");
  }
  const relEntry = entries.get("word/_rels/document.xml.rels");
  const decoder = new TextDecoder();
  return docxXmlToHtml(decoder.decode(docEntry),
    relEntry ? decoder.decode(relEntry) : "", expectedTitle);
}

/* v2.4: the image types a Word file can embed that SnakeScale
   shows inline, keyed by file extension, with their mime types.
   Any other media part (an .emf drawing, a .tiff scan) still
   imports, as a regular file attachment: see registerImage. */
const DOCX_INLINE_IMAGE_MIMES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp"
};

/* v2.4: imported images keep Word's display width (the drawing
   extent, converted at 9525 EMU per pixel) but never wider than
   the editor's 860px reading column. The width rides on the
   placeholder block, the v1.7.2 size model, so the image menu's
   own size choices can change it later like any other image. */
const IMPORT_IMAGE_MAX_WIDTH_PX = 860;

/* v2.4: the placeholder shell for one claimed Word image, in
   exactly the canonical form canonicalizeAttachmentPlaceholders
   writes on every save: a figure for a displayable image, a div
   for any other media, the class, the attachment id,
   contenteditable false, and the imported width on the block when
   Word specified one. */
function importedImagePlaceholderHtml(rec, widthPx) {
  if (rec.inline) {
    const style = widthPx > 0
      ? " style=\"width:" + widthPx + "px\"" : "";
    return "<figure class=\"ss-attachment\" data-attachment-id=\"" +
      rec.attId + "\" contenteditable=\"false\"" + style +
      "></figure>";
  }
  return "<div class=\"ss-attachment\" data-attachment-id=\"" +
    rec.attId + "\" contenteditable=\"false\"></div>";
}

/* v2.4: docxFileToHtml's sibling for the import flow: the same
   conversion, plus the package's embedded images, claimed. Each
   image part is claimed ONCE, however many runs reference it (a
   second reference reuses the record, so its bytes upload once
   and the attachment is placed twice), and the converter emits
   the standard placeholder for every reference, in document
   order. The returned images list carries the bytes; the caller
   uploads them through attachImportedDocxImages. */
async function docxFileToNoteParts(arrayBuffer, expectedTitle) {
  const entries = await readZipEntries(arrayBuffer);
  const docEntry = entries.get("word/document.xml");
  if (!docEntry) {
    throw new Error("word/document.xml not found in the file");
  }
  const relEntry = entries.get("word/_rels/document.xml.rels");
  const decoder = new TextDecoder();
  const claimed = new Map();
  const images = [];
  const imageCtx = {
    registerImage: function (entryName) {
      if (claimed.has(entryName)) { return claimed.get(entryName); }
      const bytes = entries.get(entryName);
      if (!bytes) { return null; }
      const base = entryName.split("/").pop() || "image";
      const dot = base.lastIndexOf(".");
      const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
      const mime = DOCX_INLINE_IMAGE_MIMES[ext] || "";
      const rec = {
        attId: newNoteId() + "a",
        entryName: entryName,
        name: base,
        inline: !!mime,
        /* A media type the app does not show inline is recorded
           with a generic mime, so hydration builds it a file card
           (name, Open, Download) instead of an image block. The
           record's name keeps the real file name and extension. */
        mime: mime || "application/octet-stream",
        bytes: bytes
      };
      claimed.set(entryName, rec);
      images.push(rec);
      return rec;
    }
  };
  const html = docxXmlToHtml(decoder.decode(docEntry),
    relEntry ? decoder.decode(relEntry) : "", expectedTitle, imageCtx);
  return { html: html, images: images };
}

/* Remove one placeholder from a note's stored body by attachment
   id, used when an imported image could not be uploaded: a
   placeholder whose record never lands could only ever render as
   a broken block, so the note keeps its text and loses the dead
   shell. The note is not open in the editor during import, so its
   body is still the HTML string the converter produced. */
function removeImportedPlaceholder(note, attId) {
  if (!note.body || note.body.indexOf(attId) < 0) { return; }
  const holder = document.createElement("div");
  holder.innerHTML = note.body;
  /* An image referenced twice is placed twice under the same
     attachment id, so every placement goes, not just the first. */
  const els = holder.querySelectorAll(
    ".ss-attachment[data-attachment-id=\"" + attId + "\"]");
  if (els.length) {
    els.forEach(function (el) { el.remove(); });
    note.body = holder.innerHTML;
  }
}

/* v2.4: upload one imported note's Word images through the same
   attachment pipeline the Attach flow uses: the note's provider
   driver, the attId + "__" + file name storage name, the standard
   record shape, the binary in the Drive attachments subfolder.
   An image that cannot be extracted or uploaded is skipped and
   counted, never fatal, and when uploads cannot run at all
   (offline or signed out) every image skips the same way.
   v2.4.1: this pass no longer saves the note at the end. The
   caller (importFiles) holds the note's create save until this
   pass returns and then starts it, so the records pushed here
   and the placeholder removals below are already on the note
   when its first, only create save serializes it: no persisted
   version of the note ever carries a placeholder without its
   record. What this pass still settles locally is the cache
   snapshot, and the open editor's hydration (see the end of the
   function). Returns the number of skipped images. */
async function attachImportedDocxImages(note, images) {
  let skipped = 0;
  const providerName = state.attach.defaultProvider;
  const driver = providerName ? providers[providerName] : null;
  let ready = false;
  if (driver && state.online) {
    try {
      const status = await driver.getStatus();
      ready = !!status.connected;
    } catch (err) { ready = false; }
  }
  for (const img of images) {
    let landed = false;
    if (ready) {
      try {
        if (img.bytes.length > ATTACH_MAX_BYTES) {
          throw new Error("the image is larger than the 100 MB " +
            "per file limit");
        }
        const file = new File([img.bytes], img.name,
          { type: img.mime });
        const storageName = img.attId + "__" +
          sanitizeFileName(img.name);
        const result = await driver.upload(file, storageName,
          function () { });
        note.attachments = note.attachments || [];
        note.attachments.push({
          id: img.attId,
          provider: providerName,
          fileId: String(result.fileId),
          name: img.name,
          storageName: storageName,
          mime: img.mime,
          size: img.bytes.length,
          created: new Date().toISOString()
        });
        landed = true;
      } catch (err) { landed = false; }
    }
    if (!landed) {
      skipped++;
      removeImportedPlaceholder(note, img.attId);
    }
  }
  /* v2.4.1: refresh the local cache with the records (and any
     placeholder removals) on the note. The Drive save is the
     caller's held create save, started right after this pass;
     it serializes this same object, records included. */
  saveCache();
  /* v2.4.1: the note is in the list and clickable from the moment
     it is created, while these uploads run for seconds on a real
     document. If the user has already opened it, the editor
     rendered its placeholders against the then empty record
     list and stamped each one with a missing details block, and
     an open editor never re-hydrates on its own (renderEditor
     refills only when the note on screen changes), so those
     blocks would sit there for the whole session even though
     the records have now landed. Hydrate the open note again so
     its images simply appear. */
  if (currentNote() === note) {
    finishNoteOpenAttachments(note).catch(function (err) {
      console.warn("Imported image hydration failed:", err);
    });
  }
  return skipped;
}

/* Import a batch of picked files. Each PDF import opens its note so
   the attachment upload lands in it; with several PDFs, the last one
   stays open. Text extraction from PDFs is out of scope: the PDF
   itself is the note's content, attached with its in app preview. */
async function importFiles(fileList) {
  const files = Array.prototype.slice.call(fileList || []);
  if (!files.length) { return; }
  if (!state.notebooks.length) {
    await createNotebook("Personal");
  }
  const slug = importTargetNotebookSlug();
  let imported = 0;
  const problems = [];
  for (const file of files) {
    const name = file.name || "file";
    const lower = name.toLowerCase();
    try {
      if (lower.endsWith(".txt")) {
        const text = await readBlobText(file);
        createImportedNote(slug, titleFromFileName(name),
          textToNoteBodyHtml(text));
        imported++;
      } else if (lower.endsWith(".docx")) {
        const title = titleFromFileName(name);
        /* v2.4: the parts based converter also claims the file's
           embedded images; each is uploaded through the
           attachment pipeline and placed inline where the
           document has it. Skipped images are counted into the
           summary below, never fatal to the note. */
        const parts = await docxFileToNoteParts(
          await readBlobArrayBuffer(file), title);
        /* v2.4.1: when the file carries images, the create save
           is held until the uploads have run: the records (and
           any placeholder removals for failed images) must be
           on the note before its first version is persisted, or
           that version's placeholders have no records and render
           as missing details blocks (the v2.4.0 bug). A docx
           without images saves at creation, exactly as before,
           and so do the .txt and .pdf branches below. */
        const importedNote = createImportedNote(slug, title,
          parts.html, { holdSave: parts.images.length > 0 });
        imported++;
        if (parts.images.length) {
          let skippedImages = 0;
          try {
            skippedImages = await attachImportedDocxImages(
              importedNote, parts.images);
          } finally {
            /* The held create save starts whatever happened
               above: with every record that landed, with failed
               placeholders already removed. If the attach pass
               itself threw, this save still runs and the error
               is reported by the per file catch below. */
            startImportedNoteSave(importedNote, title);
          }
          if (skippedImages > 0) {
            problems.push(name + " (" + skippedImages + " image" +
              (skippedImages === 1 ? "" : "s") +
              " could not be imported)");
          }
        }
      } else if (lower.endsWith(".pdf")) {
        const note = createImportedNote(slug, titleFromFileName(name),
          "<p><br></p>");
        imported++;
        openNote(note.id);
        const before = (note.attachments || []).length;
        await handleIncomingFiles([file]);
        if ((note.attachments || []).length === before) {
          problems.push(name + " (the note was created, but the PDF " +
            "was not attached; sign in with Google and attach it again)");
        }
      } else {
        problems.push(name + " (not a .txt, .docx, or .pdf file)");
      }
    } catch (err) {
      problems.push(name + " (" + err.message + ")");
    }
  }
  let message = imported
    ? "Imported " + imported + " note" + (imported === 1 ? "" : "s") + "."
    : "No notes were imported.";
  if (problems.length) {
    message += " Problems: " + problems.join("; ");
  }
  toast(message, problems.length > 0);
}

/* ----- v2.4: the shared notebook move path --------------------------------
   saveNoteAndSettleMove is the exact sequence the editor's notebook
   picker has always flowed into through autosave: save the note (at
   whatever path its current notebook gives it), and when that path
   differs from the path it had before, remove the old file from the
   store, or queue its deletion when the store is not connected.
   Extracted unchanged from the body of autosave below, so the
   picker and drag and drop run literally the same code. */
async function saveNoteAndSettleMove(note, previousPath) {
  const result = await saveNoteToRepo(note);
  /* v2.17.1: a paused save wrote nothing, so there is nothing
     to settle: deleting the previous path's file here would
     strand the note (its only stored copy lives there). The
     note's placement in state stands until the divergence is
     resolved and a later load or save settles it honestly. */
  if (result && result.paused) { return result; }
  if (notePath(note) !== previousPath) {
    if (state.online && state.repoExists) {
      const oldFile = await storeGetFile(previousPath);
      if (oldFile) {
        await storeDeleteFile(previousPath, oldFile.token,
          "Remove note from previous notebook");
      }
    } else {
      queueOp({ kind: "delete", path: previousPath, noteId: note.id });
    }
  }
  return result;
}

/* Move one note to another notebook, the drag and drop landing (and
   a faithful sibling of every other instant move in this app: the
   state change, the cache write, and the render happen at once,
   and the storage move finishes behind them). The notebook picker
   in the editor stays the visible truth for the open note: when
   the moved note is the one on screen, the editor's current
   contents are collected first (which, since v2.5, no longer
   touches the notebook field), the note's notebook is set to the
   target and the notebook link refreshed, and only then does the
   shared save run, so no pending autosave can ever pull the note
   back. Dropping on the notebook the note already lives in
   performs no write at all. Since v2.5 the notebook link menu is
   a second caller of this same path, next to drag and drop. */
function moveNoteToNotebook(note, targetSlug) {
  const target = state.notebooks.find(function (nb) {
    return nb.slug === targetSlug;
  });
  if (!note || !target || note.trashed || note.archived) {
    return Promise.resolve(false);
  }
  /* v2.20: a catalog shell is completed at its current path
     before anything flips the note's notebook: the shared save
     below writes at the NEW path, and its own body guard would
     look for the file there, where it does not exist yet. The
     move then proceeds exactly as before. (The open note is
     never a shell; the editor loads its body before rendering.) */
  if (note.bodyLoaded === false) {
    return ensureNoteBodyLoaded(note).then(function () {
      if (note.bodyLoaded === false) {
        toast("That note is not loaded on this device yet, so it " +
          "could not be moved.", true);
        return false;
      }
      return moveNoteToNotebook(note, targetSlug);
    });
  }
  if (note.notebook === targetSlug) { return Promise.resolve(false); }
  /* v2.17.1: a notebook move takes charge of the note's
     placement, like the trash and archive moves: it clears any
     divergence mark and runs its save against the target
     path, whose file does not exist yet, so the move completes
     instead of pausing. The episode's conflict copy remains as
     the record of the version that diverged. */
  clearNoteDivergence(note.id);
  const previousPath = notePath(note);
  const isOpen = state.selectedId === note.id;
  if (isOpen) {
    collectEditor(note);
    note.notebook = targetSlug;
    /* v2.5: the editor's visible truth for the notebook is the
       notebook link now; refresh it to the target. (renderAll
       below re-runs it anyway; this keeps the link right even
       before that render lands.) */
    refreshNotebookLink(note);
    /* v2.56: the breadcrumb's notebook segment names
       the same notebook; refresh it to the target too,
       for the same reason. */
    renderBreadcrumb(note);
  } else {
    note.notebook = targetSlug;
  }
  saveCache();
  renderAll();
  return saveNoteAndSettleMove(note, previousPath)
    .then(function () {
      saveCache();
      saveIndex();
      renderSidebar();
      renderNoteList();
      toast("Moved to " + target.name + ".");
      return true;
    })
    .catch(function (err) {
      toast("Move to " + target.name + " failed: " + err.message, true);
      return false;
    });
}

/* ----- v2.4: the Tab key inside the note body ------------------------------
   The browser's default for Tab in a contenteditable is to move
   focus to the next control, which reads as "Tab exits the note".
   This handler keeps Tab (and Shift+Tab) inside the note whenever
   the caret or selection is in #noteBody:
     - In a table cell, Tab moves to the next cell in document
       order and Shift+Tab to the previous one, selecting the
       target cell's contents (Word's behavior). Tab in the very
       last cell appends a new row, built by the same structure
       rules as the v2.2 table actions, and moves into its first
       cell. Pure navigation never marks the note dirty.
     - v2.7: inside a list item (bullet, numbered, or checklist),
       Tab indents the item one level into a sub-list and
       Shift+Tab outdents it one level (indentListItem and
       outdentListItem below, plain DOM moves, never execCommand).
       This wins over both block behaviors below for any touched
       list item; in a mixed selection the plain blocks still
       take the tab prefix path. A list inside a table cell does
       not qualify: the table navigation above has already won
       by the time this is consulted.
     - v2.111.0: the indent and outdent above belong to the
       caret only at the very beginning of the item's own
       text (caretAtListItemTextStart below), the way Word
       demotes only at a paragraph's start. With the caret
       anywhere else in the item, Tab inserts a tab
       character at the caret through the same
       insertTabAtRange the plain block path below uses,
       and Shift+Tab does nothing but stay in the note. A
       selection spanning several items still indents and
       outdents them all, wherever it starts; a selection
       inside one item behaves like a selection inside one
       plain block.
     - With a selection spanning several blocks (outside tables
       and lists), Tab prefixes every touched block with a tab
       and Shift+Tab removes one leading tab from each that has
       one; the touched blocks stay selected afterwards.
     - Otherwise (a collapsed caret, or a selection inside one
       plain block), Tab inserts a real tab character at the
       caret, replacing any selection, and Shift+Tab removes one
       tab immediately before the caret or the leading tab of the
       caret's block, doing nothing when there is neither.
   The inserted tab is a span.ss-tab holding the character: its
   scoped white-space preservation (see the CSS) renders it as a
   true tab stop gap, even at the start of a line where a raw tab
   would collapse in the body's normal flow. The span is scoped to
   the tab itself, so nothing about how an existing note renders
   changes. The character is what every downstream consumer sees:
   the saved body carries the span with the character inside it,
   the text export emits the character, and the Word exporter
   turns it into a real <w:tab/> element. */
function makeTabSpan() {
  const span = document.createElement("span");
  span.className = "ss-tab";
  span.textContent = "\t";
  return span;
}

function isTabSpan(node) {
  return !!node && node.nodeType === 1 && !!node.classList &&
    node.classList.contains("ss-tab");
}

/* The editing block (paragraph, heading, quote, code block, or list
   item) inside #noteBody that contains a node, or null. Table
   cells are deliberately not blocks here: Tab inside a table is
   navigation, handled before this is consulted, and blocks inside
   cells are excluded from the multi-block indent for the same
   reason. */
function tabBlockOf(node) {
  const bodyEl = document.getElementById("noteBody");
  let el = node && node.nodeType === 1 ? node : node && node.parentElement;
  while (el && el !== bodyEl) {
    if (/^(P|H1|H2|H3|H4|H5|H6|BLOCKQUOTE|PRE|LI)$/.test(el.tagName)) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

/* The blocks a range touches, innermost first choice: a candidate
   that contains another intersecting candidate (a list item
   holding a nested list's items, a quote wrapping a paragraph) is
   dropped in favor of the contained one, so nothing is indented
   twice. Blocks inside tables and inside attachment placeholders
   never qualify. */
function tabTouchedBlocks(bodyEl, range) {
  const candidates = Array.prototype.filter.call(
    bodyEl.querySelectorAll("p, h1, h2, h3, h4, h5, h6, blockquote, pre, li"),
    function (el) {
      if (el.closest("table")) { return false; }
      if (el.closest(".ss-attachment")) { return false; }
      return range.intersectsNode(el);
    });
  return candidates.filter(function (el) {
    return !candidates.some(function (other) {
      return other !== el && el.contains(other);
    });
  });
}

function insertLeadingTab(block) {
  block.insertBefore(makeTabSpan(), block.firstChild);
}

/* Remove a block's leading tab, whether it sits in an ss-tab span
   or as a raw character starting the block's first text node (the
   shape imported or pasted content can take). Returns whether one
   was removed. */
function removeLeadingTab(block) {
  const first = block.firstChild;
  if (!first) { return false; }
  if (isTabSpan(first)) { first.remove(); return true; }
  if (first.nodeType === 3 && first.data.charAt(0) === "\t") {
    first.deleteData(0, 1);
    if (!first.data) { first.remove(); }
    return true;
  }
  return false;
}

/* Park the caret at a node and offset, replacing the selection. */
function setBodyCaret(node, offset) {
  const sel = window.getSelection();
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/* Remove an element and park the caret where it stood. */
function removeElementAndParkCaret(el) {
  const range = document.createRange();
  range.setStartBefore(el);
  range.collapse(true);
  el.remove();
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

/* The leaf node immediately before a node in inline order (the
   previous sibling, descended to its last leaf), climbing inline
   ancestors but never out of the containing block. Returns an
   element (for example a tab span or a checkbox input) or a text
   node, or null at the block's start. */
function inlineNodeBefore(node) {
  const bodyEl = document.getElementById("noteBody");
  let n = node;
  while (n && n !== bodyEl) {
    if (n.previousSibling) {
      let sib = n.previousSibling;
      while (sib.nodeType === 1 && sib.childNodes.length &&
             !isTabSpan(sib)) {
        sib = sib.childNodes[sib.childNodes.length - 1];
      }
      return sib;
    }
    n = n.parentElement;
    if (n && /^(P|H1|H2|H3|H4|H5|H6|BLOCKQUOTE|PRE|LI|TD|TH)$/
        .test(n.tagName)) {
      return null;
    }
  }
  return null;
}

/* Shift+Tab's removal workhorse for the single-block case: remove
   one tab immediately before the caret (an ss-tab span, or a raw
   tab character ending the text before it), and failing that, the
   caret block's leading tab. Returns whether anything was removed,
   so the caller marks dirty only on a real change. */
function removeTabBeforeCaret() {
  const sel = window.getSelection();
  if (!sel.rangeCount) { return false; }
  const range = sel.getRangeAt(0);
  if (!range.collapsed) { range.deleteContents(); }
  const node = range.startContainer;
  const offset = range.startOffset;
  if (node.nodeType === 3 && offset > 0) {
    if (node.data.charAt(offset - 1) === "\t") {
      if (isTabSpan(node.parentElement) &&
          node.data.replace(/\t/g, "") === "") {
        removeElementAndParkCaret(node.parentElement);
      } else {
        node.deleteData(offset - 1, 1);
        setBodyCaret(node, offset - 1);
      }
      return true;
    }
  } else {
    const before = node.nodeType === 3
      ? inlineNodeBefore(node) : inlineChildBefore(node, offset);
    if (before) {
      if (isTabSpan(before)) {
        removeElementAndParkCaret(before);
        return true;
      }
      if (before.nodeType === 3 &&
          before.data.charAt(before.data.length - 1) === "\t") {
        if (isTabSpan(before.parentElement) &&
            before.data.replace(/\t/g, "") === "") {
          removeElementAndParkCaret(before.parentElement);
        } else {
          before.deleteData(before.data.length - 1, 1);
          setBodyCaret(before, before.data.length);
        }
        return true;
      }
    }
  }
  const block = tabBlockOf(range.startContainer);
  if (block && removeLeadingTab(block)) { return true; }
  return false;
}

/* The node before an element caret position (container, offset):
   the child just left of the caret, descended to its last leaf. */
function inlineChildBefore(container, offset) {
  if (!container || container.nodeType !== 1 || offset <= 0) {
    return null;
  }
  let child = container.childNodes[offset - 1];
  while (child && child.nodeType === 1 && child.childNodes.length &&
         !isTabSpan(child)) {
    child = child.childNodes[child.childNodes.length - 1];
  }
  return child || null;
}

/* Insert a tab at the (collapsed) range, replacing any selection
   inside the one block it sits in, and leave the caret after it. */
function insertTabAtRange(range) {
  const span = makeTabSpan();
  range.deleteContents();
  range.insertNode(span);
  const sel = window.getSelection();
  const after = document.createRange();
  after.setStartAfter(span);
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);
}

/* Select a table cell's whole contents, the way Word lands in a
   cell on Tab: typing then replaces what was there. */
function selectTableCellContents(cell) {
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(cell);
  sel.removeAllRanges();
  sel.addRange(range);
}

/* Tab and Shift+Tab inside a table: cell to cell navigation in
   document order (header cells included). Only the row append in
   the last cell changes the note, so only it marks dirty. */
function tabNavigateTable(cell, range, shift) {
  const table = cell.closest("table");
  if (!table) { return; }
  const focusNode = shift ? range.startContainer : range.endContainer;
  const focusCell = tableCellFromNode(focusNode) || cell;
  const cells = Array.prototype.slice.call(
    table.querySelectorAll("th, td"));
  const idx = cells.indexOf(focusCell);
  if (idx < 0) { return; }
  const targetIdx = idx + (shift ? -1 : 1);
  if (targetIdx < 0) { return; }
  if (targetIdx >= cells.length) {
    if (shift) { return; }
    /* Tab in the last cell grows the table by one row, built with
       the v2.2 structure rules (empty cells whose tags match the
       reference row and its section), and lands in its first
       cell. */
    const lastRow = table.rows[table.rows.length - 1];
    if (!lastRow) { return; }
    const newRow = document.createElement("tr");
    for (let i = 0; i < lastRow.cells.length; i++) {
      newRow.appendChild(emptyTableCell(tableCellTagFor(lastRow, i)));
    }
    lastRow.parentElement.appendChild(newRow);
    clearCellSelection();
    selectTableCellContents(newRow.cells[0]);
    markDirty();
    updateTableMenu();
    return;
  }
  selectTableCellContents(cells[targetIdx]);
}

/* v2.7: Tab and Shift+Tab inside list items make and unmake
   sub-lists (Chris's request; through v2.6.0 the keys inserted a
   tab character in list items and never restructured anything).
   The operations are deterministic DOM moves on the <li> itself,
   deliberately not execCommand indent or outdent, whose results
   vary by browser and can wrap blocks in blockquotes.

   The list item a node sits in, or null: the node's closest li,
   provided it belongs to this note body. A list inside a table
   cell or an attachment placeholder does not qualify (Tab in a
   table is navigation, decided before this is consulted). For a
   caret in a nested item, closest gives the innermost item, the
   one the caret is actually in. */
function listItemOfNode(node) {
  const bodyEl = document.getElementById("noteBody");
  let el = node && node.nodeType === 1 ? node : node && node.parentElement;
  if (!el || !el.closest) { return null; }
  const li = el.closest("li");
  if (!li || !bodyEl.contains(li)) { return null; }
  if (li.closest("table") || li.closest(".ss-attachment")) { return null; }
  return li;
}

/* v2.111.0: whether the collapsed caret stands at
   the very beginning of a list item's own text:
   before its first character, with nothing ahead of
   it in the item but the furniture that is not text.
   The probe is the fragment of the item standing
   before the caret. What it may hold without
   costing the caret its beginning: the checklist
   checkbox (an input, and this probe reads text
   only), stray spaces and line breaks from source
   markup, and the item's sub-lists (their text
   belongs to the items below, and a caret standing
   in one of those is in that item, which
   listItemOfNode already handed over). What costs
   it: any real character, a media or attachment
   element standing in the item, and a tab character
   itself, raw or in its span: a caret behind an
   inserted tab is not at the beginning, so Tab
   pressed there inserts another tab rather than
   demoting. An item with no text of its own is at
   its beginning wherever its caret stands in it. */
function caretAtListItemTextStart(li, range) {
  const probe = document.createRange();
  probe.setStart(li, 0);
  try {
    probe.setEnd(range.startContainer, range.startOffset);
  } catch (e) { return false; }
  const frag = probe.cloneContents();
  if (frag.querySelectorAll(
      "img, .ss-attachment").length) {
    return false;
  }
  const walker = document.createTreeWalker(
    frag, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    let anc = node.parentNode, nested = false;
    while (anc && anc !== frag) {
      if (anc.tagName === "UL" || anc.tagName === "OL") {
        nested = true;
        break;
      }
      anc = anc.parentNode;
    }
    if (nested) { continue; }
    if (/\S/.test(node.data) ||
        node.data.indexOf("\t") !== -1) {
      return false;
    }
  }
  return true;
}

/* v2.110.0: the level a list item stands at, in
   Word's terms: one for a top level item, plus one
   for every list standing between its own list and
   the note body. A level wrapper (see
   indentListItem) counts like any other nesting,
   because the sub-list it holds is a list standing
   between. */
function listItemLevel(li) {
  let level = 0;
  let el = li ? li.parentElement : null;
  while (el) {
    if (el.tagName === "UL" || el.tagName === "OL") {
      level++;
    }
    if (el.id === "noteBody") { break; }
    el = el.parentElement;
  }
  return level;
}

/* Indent one list item one level. v2.110.0: Word's
   level model (Chris's Tab report: Tab has to work
   anywhere in a list, on the first item too, as
   many times as he presses it). With a previous
   sibling item the move is the standing one: the
   item joins a sub-list inside that sibling (the
   sibling's existing list of the same tag when one
   is there, after the items it already holds,
   otherwise a fresh list of the same tag as the
   item's own list, appended as the sibling's last
   child). The first item of a list has nothing
   above it to nest under; Word's flat levels have
   no such wall, so the nested model builds the
   level out of a markerless wrapper instead: an
   li.ss-level-pad takes the item's place in its
   list, holding a fresh sub-list the item moves
   into. The wrapper is not an item: it carries no
   text of its own, no marker, and no checkbox, and
   its stylesheet rule (display:contents) gives it
   no box, so nothing renders where it stands and
   an ordered list's counting passes it by. An item
   that demotes again while heading a sub-list,
   its own or a wrapper's, meets the same wall and
   takes the same way through, one level per press.
   In a checklist the sub-list carries the
   ss-checklist class, so the decoration, the Enter
   splitting, and the box toggling that key off
   list shape keep working at depth. Levels run to
   nine, Word's ceiling; at the ninth, indent does
   nothing. Returns whether the item moved. */
function indentListItem(li) {
  /* v2.101.0: an item going back into a list gives
     up its alumni standing (see outdentListItem). */
  forgetListAlumnus(li);
  const list = li.parentElement;
  if (!list || (list.tagName !== "UL" && list.tagName !== "OL")) {
    return false;
  }
  if (listItemLevel(li) >= 9) { return false; }
  const checklist = isChecklistList(list);
  const prev = li.previousElementSibling;
  if (!prev || prev.tagName !== "LI") {
    const wrap = document.createElement("li");
    wrap.className = "ss-level-pad";
    const sub = document.createElement(
      list.tagName.toLowerCase());
    if (checklist) { sub.className = "ss-checklist"; }
    wrap.appendChild(sub);
    list.insertBefore(wrap, li);
    sub.appendChild(li);
    return true;
  }
  let sub = null;
  for (let i = 0; i < prev.children.length; i++) {
    if (prev.children[i].tagName === list.tagName) {
      sub = prev.children[i];
      break;
    }
  }
  if (!sub) {
    sub = document.createElement(list.tagName.toLowerCase());
    if (checklist) { sub.className = "ss-checklist"; }
    prev.appendChild(sub);
  } else if (checklist && sub.tagName === "UL" &&
             !sub.classList.contains("ss-checklist")) {
    sub.classList.add("ss-checklist");
  }
  sub.appendChild(li);
  return true;
}

/* Outdent one list item one level: the inverse move, defined
   only when the item's list is itself nested inside another
   item. The item moves into the parent list immediately after
   the item it was nested under; items after it in the sub-list
   stay in the sub-list, and a sub-list left with no items in it
   is removed. At the top level there is nowhere to go: a no-op.
   Returns whether the item moved. */
/* v2.101.0: forget an item's alumni standing (see
   outdentListItem): the runtime record that it was
   promoted out of a particular sub-list earlier in
   this session. Indenting the item back into any
   list ends the standing. */
function forgetListAlumnus(li) {
  const from = li.__ssAlumniOf;
  if (from && from.__ssAlumni) {
    from.__ssAlumni = from.__ssAlumni.filter(
      function (a) { return a.el !== li; });
  }
  delete li.__ssAlumniOf;
  delete li.__ssAlumniIdx;
}

function outdentListItem(li) {
  const list = li.parentElement;
  if (!list || (list.tagName !== "UL" && list.tagName !== "OL")) {
    return false;
  }
  const host = list.parentElement;
  if (!host || host.tagName !== "LI") { return false; }
  const grand = host.parentElement;
  if (!grand || (grand.tagName !== "UL" && grand.tagName !== "OL")) {
    return false;
  }
  /* v2.101.0: keep the item's visual place when its
     siblings leave the same sub-list one by one.
     Inserting every promotion immediately after the
     host item scrambled the order of sequential
     promotions (promote the second item, then the
     third, and the third landed ahead of the
     second), where Word keeps the order the items
     stand in. The sub-list remembers its alumni for
     the session, in runtime expandos only (nothing
     is saved): each carries the index it held in
     the sub-list, reconstructed as it leaves from
     its place among the items still standing plus
     the alumni that stood ahead of it. A promotion
     lands after the host, past any alumni that
     stood ahead of it, and ahead of any that stood
     behind it or of the host's own next sibling. */
  forgetListAlumnus(li);
  const standing = Array.prototype.filter.call(
    list.children, function (n) {
      return n.tagName === "LI";
    });
  let orig = standing.indexOf(li);
  const alumni = list.__ssAlumni || (list.__ssAlumni = []);
  for (let i = 0; i < alumni.length; i++) {
    if (alumni[i].idx <= orig) { orig++; }
  }
  let ref = host.nextSibling;
  while (ref) {
    if (ref.nodeType === 1 && ref.__ssAlumniOf === list &&
        ref.__ssAlumniIdx < orig) {
      ref = ref.nextSibling;
      continue;
    }
    break;
  }
  grand.insertBefore(li, ref);
  alumni.push({ el: li, idx: orig });
  alumni.sort(function (a, b) { return a.idx - b.idx; });
  li.__ssAlumniOf = list;
  li.__ssAlumniIdx = orig;
  if (!list.querySelector("li")) { list.remove(); }
  /* v2.110.0: a level wrapper whose sub-list just
     emptied goes with it, so promoting the item a
     first item demotion wrapped restores the exact
     structure the demotion started from: no dead
     wrapper is left standing where the item was. A
     wrapper still holding items stays. */
  if (host.classList.contains("ss-level-pad") &&
      !list.isConnected) {
    host.remove();
  }
  return true;
}

/* The Tab keydown itself. Returns true when the key was the note's
   to use (caret or selection inside an editable note body), in
   which case the caller preventDefaults and focus never leaves
   the note; modified Tab chords (Ctrl, Alt, Cmd) belong to the
   browser and are left alone. */
function handleBodyTabKey(ev) {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) { return false; }
  const note = currentNote();
  if (!note || note.trashed || note.archived) { return false; }
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl || bodyEl.contentEditable === "false") { return false; }
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { return false; }
  const range = sel.getRangeAt(0);
  if (!bodyEl.contains(range.startContainer)) { return false; }
  const shift = !!ev.shiftKey;
  const cell = tableCellFromNode(range.startContainer);
  if (cell) {
    tabNavigateTable(cell, range, shift);
    return true;
  }
  /* v2.40.0: inside a code block, Tab indents and Shift+Tab
     outdents the touched text lines (see codeIndentLines in
     the code block section). This is decided before the list
     and multi block paths below: a selection inside one pre
     is one block's lines, not the several blocks those paths
     prefix, and a caret in a pre is not in a plain block the
     tab character path serves. */
  const codePre = codeBlockOfNode(range.startContainer);
  if (codePre && codePre.contains(range.endContainer)) {
    codeIndentLines(codePre, range, shift);
    return true;
  }
  /* v2.7: list items indent and outdent (see the sub-list block
     above). This wins over both block behaviors below for any
     touched list item; a mixed selection sends its plain blocks
     down the tab prefix path in the same keypress. Items indent
     in document order (each lands after the previous one in the
     sub-list it joins or starts) and outdent in reverse order
     (each lands immediately after its host item, ahead of the
     ones already lifted, so their order survives too). */
  if (range.collapsed) {
    const li = listItemOfNode(range.startContainer);
    if (li) {
      /* v2.111.0: at the very beginning of the item's own
         text the keys still demote and promote (the
         v2.110.0 machinery, first item and sub-list
         heads included); anywhere else in the item Tab
         is a tab character again, inserted through the
         plain block path's own insertTabAtRange, and
         Shift+Tab does nothing but keep the key in the
         note, so focus never escapes and no level ever
         changes mid line. */
      if (caretAtListItemTextStart(li, range)) {
        const caretNode = range.startContainer;
        const caretOffset = range.startOffset;
        const moved = shift ? outdentListItem(li) :
          indentListItem(li);
        if (moved) {
          /* The move carried the item (and the caret's nodes
             with it) to a new parent; re-park the caret
             where it was inside the item, falling back to
             the item's start if the old spot no longer
             resolves. */
          try { setBodyCaret(caretNode, caretOffset); }
          catch (e) { setBodyCaret(li, 0); }
          markDirty();
        }
        return true;
      }
      if (!shift) {
        insertTabAtRange(range);
        markDirty();
      }
      return true;
    }
  } else {
    const blocks = tabTouchedBlocks(bodyEl, range);
    const items = blocks.filter(function (b) {
      return b.tagName === "LI";
    });
    /* v2.111.0: a selection inside ONE list item is not
       a multi item selection: it falls through to the
       single block behavior at the bottom (Tab
       replaces it with a tab character, Shift+Tab
       takes a tab back), exactly like a selection
       inside one paragraph. The selection spans items
       when it touches more than one block, when its
       ends stand in different items, or when it
       reaches into the starting item's own sub-list;
       the ancestors of a nested item are not counted,
       because a selection inside one nested item
       intersects them without touching their text. */
    const startItem = listItemOfNode(range.startContainer);
    const endItem = listItemOfNode(range.endContainer);
    let spansItems = items.length > 1 ||
      blocks.length > 1 || startItem !== endItem;
    if (!spansItems && startItem) {
      spansItems = Array.prototype.some.call(
        startItem.querySelectorAll("li"), function (el) {
          return range.intersectsNode(el);
        });
    }
    if (items.length && spansItems) {
      const others = blocks.filter(function (b) {
        return b.tagName !== "LI";
      });
      let changed = false;
      if (shift) {
        for (let i = items.length - 1; i >= 0; i--) {
          if (outdentListItem(items[i])) { changed = true; }
        }
        others.forEach(function (block) {
          if (removeLeadingTab(block)) { changed = true; }
        });
      } else {
        items.forEach(function (li) {
          if (indentListItem(li)) { changed = true; }
        });
        others.forEach(function (block) {
          insertLeadingTab(block);
          changed = true;
        });
      }
      const joined = document.createRange();
      joined.setStart(blocks[0], 0);
      const last = blocks[blocks.length - 1];
      joined.setEnd(last, last.childNodes.length);
      sel.removeAllRanges();
      sel.addRange(joined);
      if (changed) { markDirty(); }
      return true;
    }
    if (blocks.length > 1) {
      let changed = false;
      blocks.forEach(function (block) {
        if (shift) {
          if (removeLeadingTab(block)) { changed = true; }
        } else {
          insertLeadingTab(block);
          changed = true;
        }
      });
      const joined = document.createRange();
      joined.setStart(blocks[0], 0);
      const last = blocks[blocks.length - 1];
      joined.setEnd(last, last.childNodes.length);
      sel.removeAllRanges();
      sel.addRange(joined);
      if (changed) { markDirty(); }
      return true;
    }
  }
  if (shift) {
    if (removeTabBeforeCaret()) { markDirty(); }
  } else {
    insertTabAtRange(range);
    markDirty();
  }
  return true;
}

/* ----- v2.4: drag and drop notes between notebooks --------------------------
   One Pointer Events path for mouse, touch, and pen; the native
   HTML5 drag events are never used (they do not fire from touch at
   all). A pointerdown on a note card starts a CANDIDATE, nothing
   more:
     - mouse: the drag engages after about 6px of movement;
     - touch and pen: the drag engages only after a stationary
       long press of about 300ms. Movement past a small slop
       before that drops the candidate, so the gesture stays the
       list's own scroll, exactly as before; a pointercancel (the
       browser claiming the gesture) aborts cleanly. Tapping a
       card still opens the note, because a tap ends the candidate
       without engaging.
   Once engaged, a ghost of the card follows the pointer, the
   source card dims, moves are preventDefaulted (and the body
   holds touch-action none for the duration), and the notebook
   under the pointer highlights: the sidebar rows on wide screens,
   or, at mobile widths where the sidebar is another pane, the
   rows of the #nbDropOverlay panel shown for the drag's duration.
   Holding near the top or bottom edge of the notebook list auto
   scrolls it. Dropping runs moveNoteToNotebook (the shared picker
   move path above); dropping on the note's current notebook,
   dropping outside any target, Escape, and pointercancel all end
   the drag with no move. Cards in Trash and Archive never start a
   candidate. The ghost, overlay, and highlights are furniture:
   none of their state is serialized anywhere.
   v2.5: Trash and Archive join the notebooks as drop targets (see
   noteDragTargetAt and endNoteDrag): the sidebar entries, the
   icon rail's buttons, and two rows the mobile overlay gains.
   A drop on either runs that destination's own action function,
   the same one its editor footer button runs. In rail mode,
   hovering the Notebooks rail button mid drag opens its flyout
   so the notebooks inside stay reachable.
   v2.116: the drag learned the selection. Through v2.115 a
   drag carried the pressed card's note alone, however many
   notes stood selected (Chris's report). Now a press on a
   selected card with two or more selected arms a batch drag
   (noteIds on the drag record, a count badge on the ghost),
   and the drop runs the bulk machinery: the selection's own
   bulk actions for Trash and Archive, and the shared single
   notebook move per note for a notebook. Any other press
   arms the single drag exactly as before, and touch still
   never arms one (the v2.58 rule below). */
const NOTE_DRAG_MOUSE_PX = 6;
const NOTE_DRAG_TOUCH_SLOP_PX = 10;
const NOTE_DRAG_LONGPRESS_MS = 300;
const NOTE_DRAG_EDGE_PX = 56;
const NOTE_DRAG_EDGE_STEP_PX = 14;
let noteDrag = null;          /* the candidate or engaged drag, if any */
let noteDragClickBlock = false;
  /* Set when an engaged drag ends: the pointerup that ends it is
     followed by a click on whatever sits under the pointer (the
     source card, which would open the note, or a sidebar row,
     which would switch views), and that click is the drag's tail,
     not a fresh user intent. The one-shot document capture
     listener in initNoteDragAndDrop swallows exactly one such
     click; any later pointerdown lapses a stale flag first (the
     v2.3 cell drag lesson), so a genuine click is never eaten. */

function noteDragScrollContainer() {
  const overlay = document.getElementById("nbDropOverlay");
  if (overlay && !overlay.classList.contains("hidden")) {
    return document.getElementById("nbDropList");
  }
  return document.getElementById("sidebar");
}

/* One auto scroll step for the notebook list holding the targets:
   scrolls it when the pointer is held within the edge band, and
   reports whether it scrolled. Factored out (and state free) so
   the edge behavior can be exercised directly. */
function noteDragAutoScroll(clientY) {
  const container = noteDragScrollContainer();
  if (!container) { return false; }
  const rect = container.getBoundingClientRect();
  if (clientY < rect.top + NOTE_DRAG_EDGE_PX && container.scrollTop > 0) {
    container.scrollTop -= NOTE_DRAG_EDGE_STEP_PX;
    return true;
  }
  if (clientY > rect.bottom - NOTE_DRAG_EDGE_PX &&
      container.scrollTop <
        container.scrollHeight - container.clientHeight) {
    container.scrollTop += NOTE_DRAG_EDGE_STEP_PX;
    return true;
  }
  return false;
}

/* The drop target row under a point, by rectangle scan of the
   visible target set. A rectangle scan, rather than
   elementFromPoint, keeps the rule identical everywhere: a row
   counts when the point is inside its box. Zero size boxes (the
   hidden sidebar form, a closed flyout) never match.
   v2.5: the target set grew. Notebook rows still carry
   data-nb-slug; Trash and Archive carry data-drop-action, in the
   full sidebar (the navTrash and navArchive items), in the icon
   rail (its Trash and Archive buttons), and in the mobile
   overlay. While the overlay is shown it is the whole set;
   otherwise the set is whatever the visible sidebar form shows:
   the full sidebar, or the rail plus its flyout when open. */
function noteDragTargetAt(x, y) {
  const overlay = document.getElementById("nbDropOverlay");
  const inOverlay = overlay && !overlay.classList.contains("hidden");
  const scopes = inOverlay ? [overlay] : [
    document.getElementById("sidebar"),
    document.getElementById("sidebarRail"),
    document.getElementById("railFlyout")
  ];
  for (let s = 0; s < scopes.length; s++) {
    const scope = scopes[s];
    if (!scope) { continue; }
    const rows = scope.querySelectorAll("[data-nb-slug], [data-drop-action]");
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) { continue; }
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return rows[i];
      }
    }
  }
  return null;
}

function showNbDropOverlay(dragNote) {
  const overlay = document.getElementById("nbDropOverlay");
  const list = document.getElementById("nbDropList");
  if (!overlay || !list) { return; }
  list.innerHTML = "";
  /* v2.31: the drop targets list in the sidebar's Evernote
     order, like the other notebook pickers. */
  notebooksInSidebarOrder().forEach(function (nb) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "nb-drop-row" +
      (dragNote && nb.slug === dragNote.notebook ? " current" : "");
    row.setAttribute("data-nb-slug", nb.slug);
    row.textContent = nb.name +
      (dragNote && nb.slug === dragNote.notebook ? " (current)" : "");
    list.appendChild(row);
  });
  /* v2.5: Trash and Archive are destinations here too, as rows
     under the notebooks, marked with data-drop-action exactly
     like the sidebar entries they mirror. */
  [["trash", "Trash"], ["archive", "Archive"]].forEach(function (pair) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "nb-drop-row nb-drop-action";
    row.setAttribute("data-drop-action", pair[0]);
    row.textContent = pair[1];
    list.appendChild(row);
  });
  overlay.classList.remove("hidden");
}

function hideNbDropOverlay() {
  const overlay = document.getElementById("nbDropOverlay");
  if (overlay) { overlay.classList.add("hidden"); }
}

function positionNoteDragGhost(x, y) {
  if (!noteDrag || !noteDrag.ghost) { return; }
  noteDrag.ghost.style.left = (x - noteDrag.offsetX) + "px";
  noteDrag.ghost.style.top = (y - noteDrag.offsetY) + "px";
  /* v2.116: the batch count badge rides the ghost's
     top right corner. */
  if (noteDrag.badge) {
    const gw = noteDrag.ghost.offsetWidth || 0;
    const bw = noteDrag.badge.offsetWidth || 0;
    noteDrag.badge.style.left =
      (x - noteDrag.offsetX + gw - bw - 8) + "px";
    noteDrag.badge.style.top =
      (y - noteDrag.offsetY + 8) + "px";
  }
}

function updateNoteDragTarget(x, y) {
  if (!noteDrag) { return; }
  /* v2.5, rail mode: the rail's Notebooks button is a container,
     not a target; hovering it mid drag opens the flyout so the
     notebooks inside stay reachable as targets. */
  const railNbBtn = document.getElementById("railNotebooksBtn");
  if (railNbBtn && document.body.classList.contains("rail")) {
    const br = railNbBtn.getBoundingClientRect();
    if (br.width > 0 && x >= br.left && x <= br.right &&
        y >= br.top && y <= br.bottom) {
      openRailFlyout();
    }
  }
  const row = noteDragTargetAt(x, y);
  if (noteDrag.targetEl && noteDrag.targetEl !== row) {
    noteDrag.targetEl.classList.remove("drop-hover");
  }
  noteDrag.targetEl = row;
  /* v2.5: a target is either a notebook (data-nb-slug) or one of
     the two fixed destinations (data-drop-action). */
  noteDrag.targetSlug = row ? row.getAttribute("data-nb-slug") : null;
  noteDrag.targetAction = row ? row.getAttribute("data-drop-action") : null;
  if (row) { row.classList.add("drop-hover"); }
}

function engageNoteDrag() {
  if (!noteDrag || noteDrag.engaged) { return; }
  const drag = noteDrag;
  drag.engaged = true;
  if (drag.timer) { clearTimeout(drag.timer); drag.timer = null; }
  const card = drag.card;
  const rect = card.getBoundingClientRect();
  drag.offsetX = drag.startX - rect.left;
  drag.offsetY = drag.startY - rect.top;
  const ghost = card.cloneNode(true);
  ghost.removeAttribute("id");
  ghost.removeAttribute("data-note-id");
  ghost.classList.remove("active");
  ghost.classList.add("note-drag-ghost");
  ghost.style.width = rect.width + "px";
  document.body.appendChild(ghost);
  drag.ghost = ghost;
  /* v2.116: a batch drag says so on its face: a count
     badge in the mail drag badge's dress ("N notes"),
     riding at the ghost's top right corner (positioned
     in positionNoteDragGhost, removed in
     cleanupNoteDrag). A single drag wears none. */
  if (drag.noteIds && drag.noteIds.length > 1) {
    const badge = document.createElement("div");
    badge.className = "note-drag-count";
    badge.textContent = drag.noteIds.length + " notes";
    document.body.appendChild(badge);
    drag.badge = badge;
  }
  card.classList.add("drag-source");
  document.body.classList.add("note-drag-active");
  card.style.touchAction = "none";
  try { card.setPointerCapture(drag.pointerId); } catch (err) { }
  if (window.innerWidth <= 900) {
    showNbDropOverlay(findNoteById(drag.noteId));
  }
  if (navigator.vibrate) {
    try { navigator.vibrate(10); } catch (err) { }
  }
  positionNoteDragGhost(drag.startX, drag.startY);
}

function cleanupNoteDrag() {
  if (!noteDrag) { return; }
  const drag = noteDrag;
  noteDrag = null;
  if (drag.timer) { clearTimeout(drag.timer); }
  if (drag.targetEl) { drag.targetEl.classList.remove("drop-hover"); }
  if (drag.ghost) { drag.ghost.remove(); }
  if (drag.badge) { drag.badge.remove(); }
  if (drag.card) {
    drag.card.classList.remove("drag-source");
    drag.card.style.touchAction = "";
  }
  document.body.classList.remove("note-drag-active");
  hideNbDropOverlay();
  /* v2.5: a flyout opened for this drag closes with it. */
  closeRailFlyout();
  window.removeEventListener("pointermove", onNoteDragMove);
  window.removeEventListener("pointerup", onNoteDragUp);
  window.removeEventListener("pointercancel", onNoteDragCancel);
  document.removeEventListener("keydown", onNoteDragKeydown, true);
}

function onNoteListPointerDown(ev) {
  if (noteDrag) { return; }
  /* v2.58: a touch press never arms a note drag anymore.
     On touch the press belongs to scrolling, tapping, and
     the context menu's long press (initNoteContextMenu);
     through v2.57 a stationary touch press engaged the
     drag at the long press timer, which is the gesture
     the context menu owns now. Mouse and pen are
     unchanged: movement engages, and a pen press still
     engages at the timer below. */
  if (ev.pointerType === "touch") { return; }
  if (ev.pointerType === "mouse" && ev.button !== 0) { return; }
  if (state.view.kind === "trash" || state.view.kind === "archive") {
    return;
  }
  const target = ev.target;
  const card = target && target.closest
    ? target.closest(".note-card") : null;
  if (!card || !card.getAttribute("data-note-id")) { return; }
  const note = findNoteById(card.getAttribute("data-note-id"));
  if (!note || note.trashed || note.archived) { return; }
  /* v2.116: the drag carries the selection when it can.
     A press on a card that belongs to the current
     selection, when that selection holds two or more
     notes, arms a drag for ALL of them (Chris's report:
     he could select several notes but the drag moved
     only the one he grabbed; the drag had never once
     consulted the selection). A press on any other
     card, or with no standing selection, arms the
     single note drag it always was. The carried ids
     are captured here, at the press, in selection
     order, resolved against the view by the selection's
     own reader. */
  let dragIds = [note.id];
  if (currentSelectionSet().indexOf(note.id) >= 0) {
    const selected = selectedNotesInView();
    if (selected.length >= 2) {
      dragIds = selected.map(function (n) { return n.id; });
    }
  }
  noteDrag = {
    noteId: note.id,
    noteIds: dragIds,
    badge: null,
    pointerId: ev.pointerId,
    pointerType: ev.pointerType || "mouse",
    startX: ev.clientX,
    startY: ev.clientY,
    engaged: false,
    ghost: null,
    offsetX: 0,
    offsetY: 0,
    targetSlug: null,
    targetAction: null,
    targetEl: null,
    timer: null,
    card: card
  };
  if (noteDrag.pointerType !== "mouse") {
    noteDrag.timer = setTimeout(function () {
      if (noteDrag) { engageNoteDrag(); }
    }, NOTE_DRAG_LONGPRESS_MS);
  }
  window.addEventListener("pointermove", onNoteDragMove);
  window.addEventListener("pointerup", onNoteDragUp);
  window.addEventListener("pointercancel", onNoteDragCancel);
  document.addEventListener("keydown", onNoteDragKeydown, true);
}

function onNoteDragMove(ev) {
  if (!noteDrag || ev.pointerId !== noteDrag.pointerId) { return; }
  if (!noteDrag.engaged) {
    const moved = Math.hypot(ev.clientX - noteDrag.startX,
      ev.clientY - noteDrag.startY);
    if (noteDrag.pointerType === "mouse") {
      if (moved > NOTE_DRAG_MOUSE_PX) { engageNoteDrag(); }
    } else if (moved > NOTE_DRAG_TOUCH_SLOP_PX) {
      /* The press became a scroll before the long press landed:
         the candidate dies here and the list keeps its gesture. */
      cleanupNoteDrag();
      return;
    }
    if (!noteDrag || !noteDrag.engaged) { return; }
  }
  ev.preventDefault();
  positionNoteDragGhost(ev.clientX, ev.clientY);
  updateNoteDragTarget(ev.clientX, ev.clientY);
  noteDragAutoScroll(ev.clientY);
}

function endNoteDrag(commit) {
  if (!noteDrag) { return; }
  const drag = noteDrag;
  const wasEngaged = drag.engaged;
  const note = findNoteById(drag.noteId);
  const slug = drag.targetSlug;
  const action = drag.targetAction;
  cleanupNoteDrag();
  if (!wasEngaged) { return; }
  noteDragClickBlock = true;
  if (!commit || !note) { return; }
  /* v2.116: a batch drop (the pressed card stood in a
     selection of two or more, so the drag carried them
     all) runs through the bulk machinery, never the
     single paths below:
     - Trash and Archive hand over to the selection's
       own bulk actions (trashSelectedNotes and
       archiveSelectedNotes), which is the exact code
       the context menu's bulk items run: the selection
       is consumed and cleared, the moves run under the
       bulk pool, and the one undoable progress toast
       the menu produces is the toast the drop produces.
       The drag changed nothing about the selection on
       its way (its tail click is swallowed), so the
       set those functions read is the set the drag
       carried.
     - A notebook has no bulk action of its own, so the
       moves run the shared single move per carried
       note in turn, skipping any note already in the
       target (the single drop's own no-op rule), then
       clear the selection the way every bulk action
       does and render once at the end. When every
       carried note already lives in the target there
       is nothing to do and the selection stands, again
       the single drop's rule. */
  const carried = (drag.noteIds || []).map(function (id) {
    return findNoteById(id);
  }).filter(Boolean);
  if (carried.length >= 2) {
    if (slug) {
      const movers = carried.filter(function (n) {
        return n.notebook !== slug;
      });
      if (!movers.length) { return; }
      clearListSelections();
      let chain = Promise.resolve();
      movers.forEach(function (n) {
        chain = chain.then(function () {
          return moveNoteToNotebook(n, slug);
        });
      });
      chain.then(function () { renderAll(); }, function () {
        renderAll();
      });
      return;
    }
    if (action === "trash") { trashSelectedNotes(); return; }
    if (action === "archive") { archiveSelectedNotes(); return; }
    return;
  }
  if (slug) {
    if (slug !== note.notebook) { moveNoteToNotebook(note, slug); }
    return;
  }
  /* v2.5: the two fixed destinations run the very functions the
     editor footer buttons run, with the same confirmation
     toasts. Drag candidates are always live notes (Trash and
     Archive cards never start one), so no already-there case
     exists for either. */
  if (action === "trash") {
    moveNoteWithProgress("Deleting", "Deleted",
      "Moved to Trash.", function () {
        return moveNoteToTrash(note, false);
      }, moveUndoSnapshot("trash", [note]))
      .catch(function (err) { toast(err.message, true); });
  } else if (action === "archive") {
    moveNoteWithProgress("Archiving", "Archived",
      "Note archived.", function () {
        return archiveNote(note);
      }, moveUndoSnapshot("archive", [note]))
      .catch(function (err) { toast(err.message, true); });
  }
}

function onNoteDragUp(ev) {
  if (!noteDrag || ev.pointerId !== noteDrag.pointerId) { return; }
  endNoteDrag(true);
}

function onNoteDragCancel(ev) {
  if (!noteDrag || ev.pointerId !== noteDrag.pointerId) { return; }
  endNoteDrag(false);
}

function onNoteDragKeydown(ev) {
  if (ev.key === "Escape" && noteDrag) {
    ev.preventDefault();
    endNoteDrag(false);
  }
}

/* Wire the drag's entry points: the delegated pointerdown on the
   note list, the overlay's Cancel button, and the one-shot click
   suppression for a finished drag's tail click. Called once from
   wireEvents. */
function initNoteDragAndDrop() {
  const listEl = document.getElementById("noteList");
  if (listEl) {
    listEl.addEventListener("pointerdown", onNoteListPointerDown);
  }
  const cancelBtn = document.getElementById("nbDropCancelBtn");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", function () {
      endNoteDrag(false);
    });
  }
  document.addEventListener("pointerdown", function () {
    if (!noteDrag) { noteDragClickBlock = false; }
  }, true);
  document.addEventListener("click", function (ev) {
    if (noteDragClickBlock) {
      noteDragClickBlock = false;
      ev.stopPropagation();
      ev.preventDefault();
    }
  }, true);
}

/* v2.51: one autosave pass, as a named function
   (runEditorAutosave below). Through v2.50 this body was an
   anonymous function inside the generic debounce helper;
   v2.51 needs the pass runnable on demand, by name, because
   leaving a note now settles the outgoing note first (see
   settleOpenNoteEdits below): the settle runs THIS pass
   early rather than a second save system of its own, so a
   settle is an ordinary autosave in every respect (the
   untouched note gate, the conflict machinery, the v2.50
   settlement counts) that merely happens before the editor
   lets go of the note instead of 800 ms after the last
   keystroke. The pass reports its outcome as a string so
   the settle can tell a landing from a pause from a hard
   failure: "landed" (written, queued offline, preserved
   through a conflict, or the untouched gate's no op),
   "held" (the save paused on a diverged note; the pass
   still collected the editor into the note object, which
   is the paused state's own preservation contract), and
   "failed" (the save threw; nothing landed anywhere).
   Callers that do not care ignore the return, exactly as
   they ignored the debounce's. */
async function runEditorAutosave() {
  const note = currentNote();
  if (!note || note.trashed || note.archived) {
    /* v2.50: no live note to save: whatever edits were
       pending belonged to a note the editor has closed
       (trashed, archived, or deselected through a flow
       that persisted or discarded them by its own rules),
       so the unsettled count settles here rather than
       blocking a waiting update reload forever, and the
       settle retries the reload itself, since the render
       that closed the note ran before this settle and
       found the count still open. */
    swEditorSettledSeq = swEditorDirtySeq;
    maybeReloadForUpdate();
    /* v2.73: the editor has closed, so any parked
       transcription belongs to a note that is not open:
       its stored body can take the text now. */
    void drainParkedTranscripts();
    return "none";
  }
  const previousPath = notePath(note);
  const previousNotebook = note.notebook;
  /* v2.89: any decrypted passage in the editor is
     re-encrypted to its current text before the
     collect below reads the body, so the save writes
     the passage's present words as ciphertext, never
     a stale snapshot and never plaintext. */
  await ssencFlushEditorRegions();
  collectEditor(note);
  /* v2.50: the edit count this save collected. The settle
     below raises the settled count only to here, so an
     edit typed while this save was in flight stays
     unsettled and keeps its own later save (and landing
     hook) responsible for it. */
  const seqAtCollect = swEditorDirtySeq;
  /* v2.19: the untouched note gate. When the collected
     content matches the note's last saved baseline in full
     (title, body, tags, attachment records, pin, and
     thumbnail: noteMatchesLastSaved), this save has nothing
     to write, so it writes nothing: no Drive write, no
     queued put when offline, no version churn, and above
     all no conflict copy from a session that merely holds
     the note open with a stale revision while another
     device edits it, which is how a copy could be forked
     by a device its owner never typed on. The gate is
     deliberately here and in flushQueue, not in the save
     worker: the worker cannot tell an untouched editor
     save from a deliberate metadata save (a pin toggle's
     own save carries text identical to its baseline), and
     those must never be gated. Metadata that travels
     through THIS autosave is safe by construction: a tag
     or title edit changes the compared fields, and the
     thumbnail rides the snapshot, so real changes pass
     the gate and only true no-ops stop here. The path
     check keeps a pending notebook settle out of the
     gate's reach (moves run their own save through
     saveNoteAndSettleMove directly and never depend on
     this one), and a note with no baseline is never
     gated, so a first save always runs. */
  if (notePath(note) === previousPath && noteMatchesLastSaved(note)) {
    setSaveState("Saved " + new Date().toLocaleTimeString([], {
      hour: "numeric", minute: "2-digit" }));
    /* v2.50: the collected content is the saved baseline,
       so the edits this save collected are settled (see
       swEditorUnsettled at the v2.50 block). */
    swEditorSettledSeq = seqAtCollect;
    /* v2.50: a waiting self update reload retries at every
       landing of the save machinery; this no-op landing is
       one of them (see the v2.50 block at
       registerServiceWorker). */
    maybeReloadForUpdate();
    renderSidebar();
    renderNoteList();
    /* v2.73: this pass settled the editor, so a parked
       transcription for the open note can land at the
       card, and parked jobs for other notes can land in
       their stored bodies. */
    void drainParkedTranscripts();
    return "landed";
  }
  setSaveState("Saving...");
  /* v2.50: whether this save settles the edits it
     collected (see the settle after the catch). A paused
     or failed save settles nothing: the work is still only
     on screen, and a waiting update reload keeps waiting. */
  let saveLanded = false;
  /* v2.51: the pass's outcome for the note switch settle
     (see runEditorAutosave's header): a paused save is its
     own outcome, distinct from a landing and from a hard
     failure, because the settle treats it differently. */
  let savePaused = false;
  try {
    const result = await saveNoteAndSettleMove(note, previousPath);
    if (result && result.queued) {
      setSaveState("Offline: changes queued");
      saveLanded = true;
    } else if (result && result.conflict) {
      setSaveState("Conflict saved as a copy");
      state.selectedId = result.copy.id;
      renderEditor._forId = null;
      saveLanded = true;
    } else if (result && result.paused) {
      /* v2.17.1: the note is diverged; its saves pause until
         Reload. Say so where "Saved" would otherwise lie. */
      setSaveState("Saving paused: this note changed elsewhere");
      savePaused = true;
    } else {
      /* v2.57: the Saved wording is set only when the
         edits this pass collected are still the latest
         ones. An edit typed during the flight already
         set "Unsaved changes..." through markDirty and
         owns a later pass of its own; letting this
         landing overwrite that wording would have the
         save status (the floating pill now) claim a
         settled state the settlement counts above deny,
         in exactly the window a note switch settle or a
         waiting update reload is watching those counts.
         The save itself landed either way; only the
         wording is guarded, and the newer edit's own
         pass sets the final wording when it lands. */
      if (seqAtCollect === swEditorDirtySeq) {
        setSaveState("Saved " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
      }
      saveLanded = true;
    }
  } catch (err) {
    setSaveState("Save failed");
    toast("Save failed: " + err.message, true);
  }
  /* v2.50: settle the collected edits when the save
     landed, then retry a waiting self update reload at
     the moment the note becomes clean. */
  if (saveLanded && seqAtCollect === swEditorDirtySeq) {
    swEditorSettledSeq = seqAtCollect;
  }
  maybeReloadForUpdate();
  /* Refresh counts, ordering, and this note card without touching the
     editor pane. */
  renderSidebar();
  renderNoteList();
  void previousNotebook;
  /* v2.51: report the outcome to the note switch settle
     (see runEditorAutosave's header). Every other caller
     ignores this, as it ignored the debounce's return. */
  /* v2.73: the pass ended; whatever it settled unblocks
     the parked transcription drains (the attempts
     themselves re-check the settlement, so a pass that
     landed nothing simply parks them again). */
  void drainParkedTranscripts();
  return saveLanded ? "landed" : (savePaused ? "held" : "failed");
}

/* v2.51: the autosave's 800 ms debounce, as a named timer
   instead of the generic debounce helper, with exactly the
   debounce's behavior: every call (markDirty's, and any
   direct caller forcing a pass) resets the wait, and the
   pass that finally runs is runEditorAutosave itself. The
   timer has a name so the note switch settle below can
   cancel a pending pass: once a settle has run the pass
   early and landed the edits, the timer that was counting
   down to run it again must not fire a second, pointless
   pass against whatever note the editor shows by then. */
let editorAutosaveTimer = null;
function autosave() {
  if (editorAutosaveTimer !== null) {
    clearTimeout(editorAutosaveTimer);
  }
  editorAutosaveTimer = setTimeout(function () {
    editorAutosaveTimer = null;
    void runEditorAutosave();
  }, 800);
}

/* Cancel the pending debounced autosave pass, if one is
   counting down. Called by the note switch settle, which
   runs the pass itself, immediately, instead. */
function cancelPendingAutosave() {
  if (editorAutosaveTimer !== null) {
    clearTimeout(editorAutosaveTimer);
    editorAutosaveTimer = null;
  }
}

/* --------------------------------------------------------------------------
   v2.51: leaving a note settles the outgoing note first.

   The bug this fixes, proven in the v2.50 build's own
   experiment (and re-proven against v2.50.0 before this
   fix): edits live in the editor's fields and reach the
   note's stored object only when the debounced autosave
   collects them, 800 ms after the last keystroke. Opening
   another note inside that window re-rendered the editor
   from the new note's stored body, and the pending pass
   then collected the NEW note's fields against the new
   note: the outgoing note's last edits, which existed
   nowhere but the discarded DOM, were simply gone, and
   the save state line afterwards read "Saved".

   The settle below is the whole fix, and it is
   deliberately not a second save system: it runs the
   autosave's own pass (runEditorAutosave) early, under
   the settle's control, until the editor's unsettled
   count (the v2.50 settlement counts the self update
   reload also reads) reaches zero. Everything the
   debounced pass would have done happens identically:
   the collect, the untouched note gate, the freshness
   baseline and the inverted conflict handling inside
   saveNoteToRepo (reached through saveNoteAndSettleMove),
   the per note operation chain (a save already in flight
   for the note simply lands first; the settle's pass
   queues its own write behind it in the chain, never
   beside it), and the settlement accounting, so a waiting
   self update reload still fires at the exact moment the
   last edit lands, even when the landing is a note switch.

   When there is nothing unsettled, the settle is a no
   op: no collect, no save, no Drive write, and a clean
   switch keeps its old timing exactly (the NS section of
   the harness counts the writes to prove it).

   The settle resolves true when it is safe to leave:
   - every edit landed (written, queued offline, or
     preserved through a conflict: the pass's "landed");
   - or the save paused on a diverged note ("held"). The
     pass still collected the editor into the note
     object before its save paused, and in-memory
     preservation pending Reload is the paused state's
     own contract (the divergence machinery, not the
     switch, owns what happens next), so leaving loses
     nothing the app ever promised to keep.
   It resolves false only on a hard failure (the pass
   threw), or when edits keep arriving through five
   landed passes (something is dirtying the note faster
   than saves can land, and chasing it forever would
   trap the switch): the edits exist only in the editor,
   so the caller that is REPLACING the editor (openNote)
   aborts the switch and leaves the note open with its
   text on screen, while the callers that carry their own
   preservation (the Trash and Archive moves, whose
   unconditional writes serialize the object the pass
   collected) proceed on that basis. A save that cannot
   land is never retried by the loop at all: a failed
   pass ends the settle on the spot, and the failure is
   the autosave's own "Save failed" report, never a
   silent spin.

   One settle at a time: a second caller while one is
   running (a rapid second click at another note) attaches
   to the same promise, and its own navigation runs when
   that promise resolves, so the editor is never settled
   twice concurrently and the last navigation asked for
   is the one that stands.
   -------------------------------------------------------------------------- */
let noteSettleInFlight = null;

function settleOpenNoteEdits() {
  if (noteSettleInFlight) { return noteSettleInFlight; }
  const run = (async function () {
    try {
      const note = currentNote();
      /* Read only notes never hold unsettled edits
         (markDirty refuses them), and no note means no
         editor fields at all: nothing to settle. */
      if (!note || note.trashed || note.archived) { return true; }
      if (!swEditorUnsettled()) { return true; }
      /* The settle runs the pending pass itself, so the
         timer that would have run it later is cancelled:
         after a successful settle it could only collect
         the next note's untouched fields and report a
         phantom "Saved". */
      cancelPendingAutosave();
      /* The pass loop. A pass that lands can still leave
         the editor unsettled when NEW edits arrived while
         it was in flight: the editor stays alive during
         the settle, and the note's own machinery (the
         link bar's saves and retargets above all) can
         edit the outgoing note until the switch actually
         completes. Those edits are this settle's
         responsibility too, so a landed pass with edits
         outstanding runs the pass again for them. The
         chase is capped: if edits keep arriving through
         five landed passes, something is dirtying the
         note faster than saves can land, and the settle
         gives up rather than chase forever, leaving the
         switch to abort with the text on screen. A pass
         that does not land ends the settle at once:
         "held" resolves on the paused state's own
         preservation, and a hard failure is the caller's
         abort signal. */
      let passes = 0;
      for (;;) {
        const outcome = await runEditorAutosave();
        passes++;
        if (!swEditorUnsettled()) { return true; }
        if (outcome === "held") { return true; }
        if (outcome !== "landed") { return false; }
        if (passes >= 5) { return false; }
      }
    } catch (err) {
      /* A settle must never throw into a navigation: a
         failure to even run the pass reads as a failed
         settle, and the callers' lose-nothing rules
         apply. */
      return false;
    }
  })();
  noteSettleInFlight = run;
  const clear = function () {
    if (noteSettleInFlight === run) { noteSettleInFlight = null; }
  };
  run.then(clear, clear);
  return run;
}

function markDirty() {
  const note = currentNote();
  /* Trashed and archived notes are read only, so they never mark
     dirty and never autosave (the editor fields are disabled for them
     anyway; this is the second lock). */
  if (!note || note.trashed || note.archived) { return; }
  /* v2.50: count the edit as unsettled, so the self update
     reload can tell a dirty editor from a clean one by the
     same contract this line shows the user (see
     swEditorUnsettled at the v2.50 block). The autosave
     settles the count when its save lands. */
  swEditorDirtySeq++;
  setSaveState("Unsaved changes...");
  autosave();
}

/* Toolbar commands. execCommand is deprecated but universally supported
   for contenteditable in current browsers, and it keeps v1.0 dependency
   free. The checklist command converts the line the caret is on into
   a checklist item in place (see the v1.8.1 block right below), so the
   item starts with a checkbox input; clicking a checkbox toggles the
   done style on its <li> (handled in the body click listener below),
   and Enter inside an item is handled by the v1.6 checklist block
   further down.

   v1.3: the h1 and h2 commands stay as internal cases (the text style
   dropdown now drives formatBlock directly with the chosen tag), a
   strike case joins the emphasis commands, and clear now routes to the
   extended remove formatting helper below, which also unwraps the
   custom styled spans the v1.3 font and color controls create. Every
   command first restores the saved editor selection (see the selection
   preservation block below), because toolbar controls steal focus. */
function runToolbarCommand(cmd) {
  const body = document.getElementById("noteBody");
  restoreFormatSelection();
  body.focus();
  /* v2.118: a list press that turns out to be a
     clean no-op (the caret already stands in a
     list of the pressed type) owes the note no
     dirty mark and no decoration pass; the flag
     is read where markDirty stands at the end. */
  let listPressNoOp = false;
  if (cmd === "bold" || cmd === "italic" || cmd === "underline") {
    document.execCommand(cmd, false, null);
  } else if (cmd === "strike") {
    document.execCommand("strikeThrough", false, null);
  } else if (cmd === "h1") {
    document.execCommand("formatBlock", false, "H1");
  } else if (cmd === "h2") {
    document.execCommand("formatBlock", false, "H2");
  } else if (cmd === "ul" || cmd === "ol") {
    /* v2.68.0: on a checklist line, the raw list primitive
       toggled the list OFF instead, leaving the item's
       checkbox stranded in a paragraph with the
       paragraph's spacing around it: the bullet button
       appeared to just add space above and below the line
       (Chris's checklist report). A list in this editor
       has exactly one type, so the command now converts
       the checklist into the requested plain list where
       it stands (convertChecklistToPlainList, with the
       checklist machinery below), exactly as the
       Checklist command converts a plain list the other
       way. Anywhere else the primitives ran as
       before; v2.118 narrows that (see the plain
       list routes in this branch): the primitives
       now run only when the caret is outside
       any list. */
    const listCtx = checklistCaretContext();
    if (listCtx && listCtx.li && isChecklistList(listCtx.list)) {
      convertChecklistToPlainList(listCtx.list, cmd === "ol",
        listCtx.li);
    } else if (listCtx && listCtx.li && listCtx.list) {
      /* v2.118: the caret stands in a PLAIN list.
         Through v2.117 this case fell through to
         createPlainListAtCaret and its raw browser
         primitive, which knows nothing about
         branches: a second Bullet press on a
         sublist that had just become bullets
         re-typed and merged at whole list scope
         (Chris's device report). The routes are
         hand run now, over exactly the list
         containing the caret: the pressed type
         already standing is a clean no-op, and
         the other type swaps that one list
         element by hand (swapPlainListTag). */
      if (listCtx.list.tagName ===
          (cmd === "ol" ? "OL" : "UL")) {
        listPressNoOp = true;
      } else {
        swapPlainListTag(listCtx.list, cmd === "ol",
          listCtx.li);
      }
    } else {
      /* v2.101.0: creation runs through the app's own
         path, which normalizes the primitive's result
         on the spot (see createPlainListAtCaret).
         v2.118: this is now the only route that
         reaches it: the caret is outside any list. */
      createPlainListAtCaret(cmd === "ol");
    }
  } else if (cmd === "checklist") {
    toggleChecklistAtCaret();
  } else if (cmd === "clear") {
    clearFormattingExtended();
  }
  /* v2.117: a list conversion can strip or add
     done states (see the conversion functions
     below); resync the done wraps over the body
     so the painting follows the new states at
     once. Idempotent for every other command.
     v2.118: a no-op list press skips both calls:
     nothing changed, so there is nothing to
     resync and nothing to save. */
  if (!listPressNoOp) {
    decorateDoneItems(body);
    markDirty();
  }
}

/* --------------------------------------------------------------------------
   v1.8.1 checklists: the toolbar button converts the current line
   Through v1.8 the checklist command inserted a brand new checklist
   block holding filler text, plus a spare empty paragraph after it:
   the user's own line was left alone and the new block landed
   wherever the caret happened to be. Now the button behaves like
   the bullet and numbered list buttons beside it: it converts the
   line the caret is on, in place. The line keeps its own text, the
   checkbox appears at the start of that same line, the caret stays
   on that line, no new line is created, and no filler text is
   inserted anywhere. Pressing it with the caret inside a checklist
   item converts that item back into a normal paragraph.

   The result always uses the existing checklist shape (a
   <ul class="ss-checklist"> whose items start with a checkbox
   input), so the v1.6 Enter behavior and the done styling work on a
   converted list exactly as on any other.

   Conversion routes by what the caret is in:
     - a checklist item: that item becomes a paragraph (below);
     - a plain bullet list: the list becomes a checklist in place;
     - a numbered list: it is swapped for a checklist with the
       same items;
     - any other block (paragraph, heading, and friends): the
       toolbar's usual list primitive (execCommand
       insertUnorderedList) is tried first, and its result is then
       normalized into checklist shape. Where that primitive is
       missing or does not take (some embedded browsers ship
       without it), convertBlockToChecklistItem does the same work
       by hand, so the result is identical either way.
   A selection spanning several lines converts from the line where
   the selection starts; the primitive, when it runs, naturally
   takes the lines it covers.
   -------------------------------------------------------------------------- */

/* The editing context at the caret, for the checklist command: the
   list item and list around the caret when it is inside one, and
   otherwise the top level block that holds the caret (null when the
   caret sits directly in the body, outside any block). */
function checklistCaretContext() {
  const bodyEl = document.getElementById("noteBody");
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { return null; }
  const range = sel.getRangeAt(0);
  if (!bodyEl.contains(range.startContainer)) { return null; }
  let node = range.startContainer;
  if (node.nodeType !== 1) { node = node.parentNode; }
  if (!node) { return null; }
  const li = node.closest ? node.closest("li") : null;
  if (li && bodyEl.contains(li)) {
    return { li: li, list: li.parentElement, block: li };
  }
  let block = node;
  while (block && block !== bodyEl &&
         block.parentElement && block.parentElement !== bodyEl) {
    block = block.parentElement;
  }
  if (!block || block === bodyEl) { block = null; }
  return { li: null, list: null, block: block };
}

/* How far into a block's text the caret sits, counted in characters
   from the block's start. Used to put the caret back on the same
   spot of the same line after a conversion rebuilds the line's
   markup around it. */
function caretTextOffsetWithin(root, range) {
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

/* Place the caret offset characters into root's text. Past the end
   (or in a block with no text at all, such as a freshly emptied
   checklist item) the caret lands at the end of the content, which
   for a checklist item is right after the checkbox. */
function placeCaretAtTextOffset(root, offset) {
  const sel = window.getSelection();
  if (!sel) { return; }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let node = walker.nextNode();
  let remaining = offset;
  while (node) {
    if (remaining <= node.nodeValue.length) {
      const caret = document.createRange();
      caret.setStart(node, remaining);
      caret.collapse(true);
      sel.removeAllRanges();
      sel.addRange(caret);
      return;
    }
    remaining -= node.nodeValue.length;
    node = walker.nextNode();
  }
  const end = document.createRange();
  end.setStart(root, root.childNodes.length);
  end.collapse(true);
  sel.removeAllRanges();
  sel.addRange(end);
}

/* v2.101.0: an item's OWN text: the text nodes whose
   nearest list item is this one, so the text of a
   sublist nested inside the item never counts toward
   the item it hangs under. The checklist Backspace
   join, the checkbox click caret restore, and the
   list creation caret restore all reckon in this
   currency. */
function itemOwnTextNodes(li) {
  const nodes = [];
  const walker = document.createTreeWalker(li,
    NodeFilter.SHOW_TEXT, null);
  let node = walker.nextNode();
  while (node) {
    if (node.parentNode && node.parentNode.closest &&
        node.parentNode.closest("li") === li) {
      nodes.push(node);
    }
    node = walker.nextNode();
  }
  return nodes;
}

function itemOwnTextLength(li) {
  return itemOwnTextNodes(li).reduce(function (sum, n) {
    return sum + n.nodeValue.length;
  }, 0);
}

/* Place the caret offset characters into an item's
   own text (see itemOwnTextNodes). Past its end the
   caret lands at the end of that text; in an item
   with no text of its own it lands right after the
   item's leading element (its checkbox), or at the
   item's start when it has neither. */
function placeCaretAtItemTextOffset(li, offset) {
  const sel = window.getSelection();
  if (!sel) { return; }
  const nodes = itemOwnTextNodes(li);
  let remaining = offset;
  for (let i = 0; i < nodes.length; i++) {
    if (remaining <= nodes[i].nodeValue.length) {
      const caret = document.createRange();
      caret.setStart(nodes[i], remaining);
      caret.collapse(true);
      sel.removeAllRanges();
      sel.addRange(caret);
      return;
    }
    remaining -= nodes[i].nodeValue.length;
  }
  const caret = document.createRange();
  if (nodes.length) {
    const last = nodes[nodes.length - 1];
    caret.setStart(last, last.nodeValue.length);
  } else if (li.firstChild) {
    caret.setStartAfter(li.firstChild);
  } else {
    caret.setStart(li, 0);
  }
  caret.collapse(true);
  sel.removeAllRanges();
  sel.addRange(caret);
}

/* Give one list item the checklist's leading checkbox, unless it
   already starts with one. */
function ensureChecklistCheckbox(li) {
  const first = li.firstElementChild;
  if (first && first.tagName === "INPUT" && first.type === "checkbox") {
    return;
  }
  const box = document.createElement("input");
  box.type = "checkbox";
  li.insertBefore(box, li.firstChild);
}


/* v2.117: the lists one list conversion acts on.
   Converting the list containing the caret must
   convert exactly that list, no more and no less.
   The one gap in the geometry checklistCaretContext
   already scopes (it returns the innermost list)
   is the ss-level-pad wrapper (see indentListItem
   and li.ss-level-pad in the stylesheet): the pad
   is a stand-in for the list's own first level, a
   markerless item that exists only to hold the
   sublist a first item demoted into, so a list
   standing inside one of the list's own pads is
   part of THIS list for conversion, not a branch
   of it. Through v2.116.0 the conversions below
   walked direct items only and skipped the pad
   (it is not an item), so its inner list kept the
   old type whole: a checklist converted to bullets
   at the top level left the padded items behind
   as a checklist with their boxes (rig proof in
   the build report). A genuine sublist, a list
   inside a normal item, is a branch: it is never
   in this set, so it keeps its own type, boxes,
   and states when the list above it converts,
   exactly as a branch conversion leaves the rest
   of the tree alone. Pads can nest (a demoted
   first item inside a padded level), so the walk
   recurses through them. */
function conversionListTargets(list) {
  const out = [list];
  const walk = function (l) {
    Array.from(l.children).forEach(function (li) {
      if (li.tagName === "LI" &&
          li.classList.contains("ss-level-pad")) {
        Array.from(li.children).forEach(
          function (sub) {
            if (sub.tagName === "UL" ||
                sub.tagName === "OL") {
              out.push(sub);
              walk(sub);
            }
          });
      }
    });
  };
  walk(list);
  return out;
}

/* Turn an existing list into a checklist where it stands: the
   ss-checklist class on the list, and a checkbox at the start of
   every item. The items' own content is not touched.
   v2.117: the work runs over the conversion targets
   (see conversionListTargets), so a list standing inside
   one of this list's own level pads converts with it,
   while a genuine sublist in a normal item is untouched. */
function makeOneListChecklist(ul) {
  ul.classList.add("ss-checklist");
  for (let i = 0; i < ul.children.length; i++) {
    if (ul.children[i].tagName !== "LI") { continue; }
    /* v2.110.0: a level wrapper is not an item and
       never takes a box; without this it would grow
       one here and render as an empty checklist
       row. */
    if (ul.children[i].classList.contains(
        "ss-level-pad")) {
      continue;
    }
    ensureChecklistCheckbox(ul.children[i]);
  }
}

function makeListChecklist(ul) {
  conversionListTargets(ul).forEach(function (l) {
    makeOneListChecklist(l);
  });
}

/* The hand done fallback for turning a plain block into a checklist
   item, used when the insertUnorderedList primitive is unavailable
   or did not run. The block's own content moves into the item, so
   the line keeps its text (and any inline formatting) exactly. */
function convertBlockToChecklistItem(block, range) {
  const bodyEl = document.getElementById("noteBody");
  const ul = document.createElement("ul");
  ul.className = "ss-checklist";
  const li = document.createElement("li");
  const box = document.createElement("input");
  box.type = "checkbox";
  li.appendChild(box);
  ul.appendChild(li);
  let offset = 0;
  if (block) {
    if (range) { offset = caretTextOffsetWithin(block, range); }
    while (block.firstChild) { li.appendChild(block.firstChild); }
    /* An emptied block's lone <br> is a placeholder the browser put
       there, not content; leaving it would make the item look
       filled to the Enter handler. */
    if (li.childNodes.length === 2 && li.lastChild.tagName === "BR" &&
        !checklistItemText(li).trim()) {
      li.removeChild(li.lastChild);
    }
    block.replaceWith(ul);
  } else if (range && range.startContainer.nodeType === 3 &&
             range.startContainer.parentNode === bodyEl) {
    /* The caret sits in a bare text run directly under the body
       (no wrapping block): the run becomes the item's text. */
    const anchor = range.startContainer.nextSibling;
    offset = range.startOffset;
    li.appendChild(range.startContainer);
    bodyEl.insertBefore(ul, anchor);
  } else {
    /* No block and no text run (an empty body): the fresh list is
       simply appended, holding one empty item. */
    bodyEl.appendChild(ul);
  }
  placeCaretAtTextOffset(li, offset);
}

/* v2.101.0: lift a list out of the paragraph (or
   heading) the browser's list primitive wrapped it
   in. insertUnorderedList and insertOrderedList, in
   this Chromium, wrap rather than replace the block,
   leaving <p><ul>...</ul></p> (audit D1): invalid
   HTML whose saved form then reshapes on the save
   funnel's reparse, so the file and the note on
   screen disagree (D1b). The host's content before
   the list keeps a block of the host's own tag ahead
   of the list, its content after the list keeps the
   host itself, and a side left with nothing (or
   nothing but a placeholder break) loses its block
   entirely. */
function unwrapListFromParagraph(list) {
  const bodyEl = document.getElementById("noteBody");
  if (!list || !list.parentElement || !bodyEl) { return; }
  const host = list.parentElement;
  if (host === bodyEl) { return; }
  if (!/^(P|H1|H2|H3|H4|H5|H6)$/.test(host.tagName)) {
    return;
  }
  if (host.parentElement !== bodyEl) { return; }
  const before = document.createElement(
    host.tagName.toLowerCase());
  while (host.firstChild && host.firstChild !== list) {
    before.appendChild(host.firstChild);
  }
  host.parentElement.insertBefore(list, host);
  if (before.childNodes.length) {
    list.parentElement.insertBefore(before, list);
  }
  if (!host.childNodes.length ||
      (host.childNodes.length === 1 &&
       host.firstChild.tagName === "BR") ||
      (!host.textContent.trim() &&
       !host.querySelector("img, input, .ss-attachment"))) {
    host.remove();
  }
}

/* v2.101.0: the Bullet and Numbered commands' own
   creation path (audit D1 and D1b). The browser
   primitive still does the initial conversion, but
   its result is normalized on the spot: the list is
   lifted out of any block the primitive wrapped it
   in, and the caret is restored to the end of the
   item's own text, where the user was typing when
   the primitive reset it to the item's start. A
   primitive that toggled an existing list of the
   same kind off has done the command's whole work
   and is left alone. Where the primitive is missing
   or refuses, the list is built by hand from the
   caret's block, the convertBlockToChecklistItem
   shape without the box. */
function createPlainListAtCaret(ordered) {
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl) { return; }
  const before = checklistCaretContext();
  const block = before ? before.block : null;
  const sel = window.getSelection();
  const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  const tag = ordered ? "OL" : "UL";
  const wasInSame = !!(before && before.li && before.list &&
    before.list.tagName === tag);
  let worked = false;
  if (typeof document.execCommand === "function") {
    try {
      worked = document.execCommand(
        ordered ? "insertOrderedList" : "insertUnorderedList",
        false, null);
    } catch (err) { worked = false; }
  }
  if (worked) {
    const after = checklistCaretContext();
    if (after && after.li && after.list &&
        after.list.tagName === tag) {
      unwrapListFromParagraph(after.list);
      placeCaretAtItemTextOffset(after.li,
        itemOwnTextLength(after.li));
    }
    /* No list at the caret after a successful
       primitive: it toggled a standing list off, or
       it converted in a shape the context does not
       resolve; either way its result stands as the
       old commands left it. */
    return;
  }
  if (wasInSame) { return; }
  const list = document.createElement(tag.toLowerCase());
  const li = document.createElement("li");
  list.appendChild(li);
  if (block) {
    while (block.firstChild) {
      li.appendChild(block.firstChild);
    }
    if (li.childNodes.length === 1 &&
        li.firstChild.tagName === "BR" &&
        !li.textContent.trim()) {
      li.removeChild(li.firstChild);
    }
    block.replaceWith(list);
  } else if (range && range.startContainer.nodeType === 3 &&
             range.startContainer.parentNode === bodyEl) {
    const anchor = range.startContainer.nextSibling;
    li.appendChild(range.startContainer);
    bodyEl.insertBefore(list, anchor);
  } else {
    bodyEl.appendChild(list);
  }
  placeCaretAtItemTextOffset(li, itemOwnTextLength(li));
}

/* v2.24.7: tag the pieces a checklist split leaves behind, so the
   stylesheet can keep the converted line at the checklist's own
   tight spacing instead of the paragraph's default margins (see
   the ss-checklist-exit rules among the note body styles). The
   paragraph gets ss-checklist-exit and each half that survives
   gets ss-checklist-split; when the item was the list's only one,
   no half survives and nothing is tagged, so the paragraph simply
   stands where the list stood. Both tags are inert apart from
   those spacing rules. They cannot accumulate across toggles:
   toggling the line back into a checklist replaces the paragraph
   outright, and classList.add on a list that is split again is a
   no-op the second time. Called with the pieces in their final
   places (the emptied upper list already removed, the lower half
   already inserted when it has items). */
function markChecklistExit(p, ul, rest) {
  const upperStays = ul.isConnected && !!ul.querySelector("li");
  const lowerStays = rest.isConnected && !!rest.querySelector("li");
  if (upperStays) { ul.classList.add("ss-checklist-split"); }
  if (lowerStays) { rest.classList.add("ss-checklist-split"); }
  if (upperStays || lowerStays) {
    p.classList.add("ss-checklist-exit");
  }
}

/* Toggle one checklist item back into a normal paragraph, in place.
   The list splits around the paragraph, the same shape the v1.6
   Enter handler leaves when an item exits a checklist: items above
   stay a checklist, items below stay a checklist of their own, and
   an emptied list is removed. */
function checklistItemToParagraph(li, ul) {
  const sel = window.getSelection();
  const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  let offset = range ? caretTextOffsetWithin(li, range) : 0;
  const p = document.createElement("p");
  /* Move everything but the checkbox into the paragraph. */
  while (li.firstChild) {
    const child = li.firstChild;
    if (child.nodeType === 1 && child.tagName === "INPUT" &&
        child.type === "checkbox") {
      li.removeChild(child);
    } else {
      p.appendChild(child);
    }
  }
  /* Checklist items written by older versions carry one separator
     space after the checkbox; that space was formatting, not text,
     so it does not follow the line back into a paragraph. */
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, null);
  const firstText = walker.nextNode();
  if (firstText && firstText.nodeValue.charAt(0) === " ") {
    firstText.nodeValue = firstText.nodeValue.slice(1);
    if (offset > 0) { offset -= 1; }
  }
  if (!p.childNodes.length) { p.appendChild(document.createElement("br")); }
  const rest = document.createElement("ul");
  rest.setAttribute("class", ul.getAttribute("class") || "ss-checklist");
  let next = li.nextSibling;
  while (next) {
    const moving = next;
    next = next.nextSibling;
    rest.appendChild(moving);
  }
  li.remove();
  ul.after(p);
  if (rest.childNodes.length) { p.after(rest); }
  if (!ul.querySelector("li")) { ul.remove(); }
  /* v2.24.7: the checkbox is the only thing that goes away; the
     line keeps the checklist's spacing (see markChecklistExit). */
  markChecklistExit(p, ul, rest);
  placeCaretAtTextOffset(p, offset);
}

/* The Checklist toolbar command itself. Decides from the caret's
   context, per the routes in this block's header comment. */
function toggleChecklistAtCaret() {
  const ctx = checklistCaretContext();
  if (!ctx) { return; }
  const sel = window.getSelection();
  const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;

  /* In a checklist already: toggle the item back to a paragraph. */
  if (ctx.li && isChecklistList(ctx.list)) {
    checklistItemToParagraph(ctx.li, ctx.list);
    return;
  }
  /* In a plain bullet list: the list itself becomes a checklist. */
  if (ctx.li && ctx.list && ctx.list.tagName === "UL") {
    makeListChecklist(ctx.list);
    return;
  }
  /* In a numbered list: swap it for a checklist with the same items.
     v2.117: every conversion target swaps (see
     conversionListTargets), so a list inside one of this
     list's own level pads becomes a checklist with it;
     makeListChecklist on the head of the set reaches the
     rest through the same pads. */
  if (ctx.li && ctx.list && ctx.list.tagName === "OL") {
    const targets = conversionListTargets(ctx.list);
    const head = targets.map(function (l) {
      const ul = document.createElement("ul");
      while (l.firstChild) { ul.appendChild(l.firstChild); }
      l.replaceWith(ul);
      return ul;
    });
    head.forEach(function (ul) {
      makeOneListChecklist(ul);
    });
    return;
  }
  /* Any other block, or no block at all: the toolbar's list
     primitive first, its result normalized into checklist shape;
     the hand done conversion whenever the primitive is missing or
     did not produce a list at the caret. */
  let primitiveWorked = false;
  if (ctx.block && typeof document.execCommand === "function") {
    try {
      primitiveWorked =
        document.execCommand("insertUnorderedList", false, null);
    } catch (err) {
      primitiveWorked = false;
    }
  }
  if (primitiveWorked) {
    const after = checklistCaretContext();
    if (after && after.list && after.list.tagName === "UL") {
      makeListChecklist(after.list);
      /* v2.101.0: the same normalization the plain
         commands get (audit D1, and the D2 chain it
         started): the list stands at the top level,
         and the caret goes back to the end of the
         item's own text, so conversion cannot hand
         the Enter handler a caret parked ahead of
         the checkbox with the item's text behind it. */
      unwrapListFromParagraph(after.list);
      if (after.li) {
        placeCaretAtItemTextOffset(after.li,
          itemOwnTextLength(after.li));
      }
      return;
    }
  }
  convertBlockToChecklistItem(ctx.block, range);
}

/* v2.68.0: turn a checklist into a plain bullet or numbered
   list where it stands, the Bullet and Numbered commands'
   answer to the Checklist command's makeListChecklist (which
   converts a whole plain list the other way). The items keep
   their text and inline formatting; what made the list a
   checklist goes away: the ss-checklist class, each item's
   leading checkbox, each item's done class (the note body
   stylesheet strikes any li.done, and a plain item has no
   done state to carry), and the one separator space older
   versions wrote after a checkbox, stripped per item exactly
   as checklistItemToParagraph strips it on the paragraph
   path. For the numbered form the list element itself is
   swapped UL for OL with the same children, the reverse of
   the swap toggleChecklistAtCaret performs. The caret is
   restored into its own item at its own text offset. */
function convertChecklistToPlainList(list, ordered, caretLi) {
  const sel = window.getSelection();
  const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  let offset = range && caretLi
    ? caretTextOffsetWithin(caretLi, range) : 0;
  /* v2.117: the conversion runs over the conversion
     targets (see conversionListTargets): the list
     containing the caret converts whole, its own level
     pads included, and nothing beyond it. A genuine
     sublist inside one of its items is not a target, so
     it keeps its type, its boxes, and its states. Level
     wrapper items are skipped as items (they are not
     items), which also keeps the separator space strip
     below from reaching through a pad into the first
     padded item's text. */
  const targets = conversionListTargets(list).map(
    function (l) {
      let target = l;
      if (ordered && l.tagName === "UL") {
        target = document.createElement("ol");
        while (l.firstChild) {
          target.appendChild(l.firstChild);
        }
        l.replaceWith(target);
      }
      return target;
    });
  targets.forEach(function (target) {
    target.classList.remove("ss-checklist");
    /* An emptied class attribute does not ride into the
       saved body; the attribute itself goes too. */
    if (!target.classList.length) {
      target.removeAttribute("class");
    }
    for (let i = 0; i < target.children.length; i++) {
      const li = target.children[i];
      if (li.tagName !== "LI") { continue; }
      if (li.classList.contains("ss-level-pad")) {
        continue;
      }
      li.classList.remove("done");
      if (!li.classList.length) {
        li.removeAttribute("class");
      }
      const head = li.firstElementChild;
      if (head && head.tagName === "INPUT" &&
          head.type === "checkbox") {
        head.remove();
      }
      const walker = document.createTreeWalker(li,
        NodeFilter.SHOW_TEXT, null);
      const firstText = walker.nextNode();
      if (firstText &&
          firstText.nodeValue.charAt(0) === " ") {
        firstText.nodeValue =
          firstText.nodeValue.slice(1);
        if (li === caretLi && offset > 0) {
          offset -= 1;
        }
      }
    }
  });
  if (caretLi) {
    placeCaretAtTextOffset(caretLi, Math.max(0, offset));
  }
}

/* v2.118: swap one plain list's element for the
   other plain tag, UL for OL or OL for UL, where
   it stands: the Bullet and Numbered commands'
   answer when the caret stands in a plain list
   of the other type. The work runs over the
   conversion targets (see conversionListTargets),
   so a list standing inside one of this list's
   own level pads swaps with it, exactly as the
   checklist conversions treat their pads, while a
   genuine sublist inside one of its items is not
   a target and keeps its own tag. The children
   move across as nodes, so every item keeps its
   content, its nested lists, and its states; the
   classes ride across too, except a Numbering
   style class (an ss-num-* class names a style a
   numbered list carries), which a bullet list
   result drops, the mirror of the checklist
   swap's class handling in toggleChecklistAtCaret.
   The caret is restored into its own item at its
   own text offset. Hand run throughout: the
   browser's list primitive never sees a press
   whose caret stands inside a list (see
   runToolbarCommand). */
function swapPlainListTag(list, ordered, caretLi) {
  const sel = window.getSelection();
  const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  let offset = range && caretLi
    ? caretTextOffsetWithin(caretLi, range) : 0;
  const want = ordered ? "OL" : "UL";
  conversionListTargets(list).forEach(function (l) {
    if (l.tagName === want) { return; }
    const target = document.createElement(
      want.toLowerCase());
    if (l.getAttribute("class")) {
      target.setAttribute("class",
        l.getAttribute("class"));
    }
    while (l.firstChild) {
      target.appendChild(l.firstChild);
    }
    l.replaceWith(target);
    if (target.tagName === "UL") {
      ["ss-num-decimal", "ss-num-upper-alpha",
       "ss-num-lower-alpha", "ss-num-upper-roman",
       "ss-num-lower-roman"].forEach(function (c) {
        target.classList.remove(c);
      });
      if (!target.classList.length) {
        target.removeAttribute("class");
      }
    }
  });
  if (caretLi) {
    placeCaretAtTextOffset(caretLi, Math.max(0, offset));
  }
}

/* --------------------------------------------------------------------------
   v1.6 checklists: recognition, and Enter that continues the list
   A checklist is a <ul class="ss-checklist"> whose items start with a
   checkbox input. Checklists saved before v1.6 have the same items but
   no class; isChecklistList recognizes them by content, and
   normalizeChecklists tags them when a note opens, so old and new
   notes look and behave the same. The stylesheet (see the checklist
   rules near the note body styles) keeps bullets off both forms.
   -------------------------------------------------------------------------- */
function isChecklistList(ul) {
  if (!ul || ul.tagName !== "UL") { return false; }
  if (ul.classList.contains("ss-checklist")) { return true; }
  /* v2.110.0: a level wrapper can head the list and
     is not an item, so the content probe reads the
     first true item past it. */
  const first = ul.querySelector(
    "li:not(.ss-level-pad)") || ul.querySelector("li");
  if (!first) { return false; }
  const head = first.firstElementChild;
  return !!head && head.tagName === "INPUT" && head.type === "checkbox";
}

function normalizeChecklists(rootEl) {
  if (!rootEl || !rootEl.querySelectorAll) { return; }
  rootEl.querySelectorAll("ul").forEach(function (ul) {
    if (isChecklistList(ul)) { ul.classList.add("ss-checklist"); }
  });
}

/* v2.7: keep a checklist item's box in step with its saved state.
   The single source of truth for "done" is the done class on the
   <li>: it is part of the serialized body, so it is what survives
   saving, and the strikethrough is drawn from it (see the li.done
   rules in the stylesheet). The box's checked state, by contrast,
   lives in the input's checked PROPERTY, and clicking a box flips
   the property without touching the serialized form; through
   v2.6.0 nothing mirrored the property into the checked ATTRIBUTE
   (the only form innerHTML carries) and nothing restored the
   property from the class when a note opened, so a checked item
   came back with struck text and an empty box (Chris's report).
   syncChecklistBox closes both directions for one box: the
   property is set from the class, and the attribute is set or
   removed to match, so the next serialization carries the state
   too. syncChecklistBoxes runs over a whole body at render (see
   renderEditor), which also HEALS notes saved by the buggy
   builds: their done items carry the class and no attribute, and
   they open with their boxes checked. */
function syncChecklistBox(box) {
  if (!box || box.tagName !== "INPUT" || box.type !== "checkbox") {
    return;
  }
  const li = box.closest ? box.closest("li") : null;
  if (!li) { return; }
  const done = li.classList.contains("done");
  box.checked = done;
  if (done) { box.setAttribute("checked", ""); }
  else { box.removeAttribute("checked"); }
}

function syncChecklistBoxes(rootEl) {
  if (!rootEl || !rootEl.querySelectorAll) { return; }
  rootEl.querySelectorAll("input[type=\"checkbox\"]").forEach(
    function (box) { syncChecklistBox(box); });
}
/* v2.117: a done item's finished look wraps its
   OWN content, and nothing else. Through v2.116.0
   the look stood in one stylesheet rule on the
   item itself (#noteBody li.done), and it bled
   into every list nested under the item: the
   muted color is inherited by the nested items,
   and a line through set on an ancestor is
   painted by the browser across all of its
   descendants, so checking an item struck and
   muted its unchecked children (Chris's report).
   The state itself was never wrong (the click
   handler marks only the clicked item, and
   syncChecklistBox above mirrors only its box);
   only the painting spread. A stylesheet reset on
   the children is a proven non fix: it restores
   their color, but the ancestor's line still
   paints through them (Chromium probe, build
   report). So the painting moves onto furniture:
   syncDoneItemWrap wraps each run of the item's
   own content (everything that is not its
   checkbox, a nested list, or a block child) in a
   span.ss-done-own, and the stylesheet rule now
   stands on li.done > .ss-done-own. The spans are
   editor furniture in the standing pattern (the
   link faces, the code caret break): rederived
   whenever the body is decorated, and unwrapped
   in collectEditor, the one funnel every saved
   body passes through, so no saved note ever
   carries one. Typing inside a done item types
   inside its span, so new text takes the look
   with no further work; the passes that call
   decorateDoneItems (render, the checkbox
   toggle, the app claimed list keys, toolbar
   commands, the paste doors) rewrap after any
   structural change, and unwrapDoneOwnSpans
   inside an item that is not done keeps a stale
   span from ever striking on its own: the rule
   also keys on li.done, so a stray span in an
   open item paints nothing. */
function unwrapDoneOwnSpans(li) {
  if (!li || !li.querySelectorAll) { return; }
  li.querySelectorAll(":scope > span.ss-done-own")
    .forEach(function (span) {
      while (span.firstChild) {
        span.parentNode.insertBefore(
          span.firstChild, span);
      }
      span.remove();
    });
}

function syncDoneItemWrap(li) {
  if (!li || li.tagName !== "LI") { return; }
  /* A level wrapper is not an item: it holds a
     sublist and no text of its own (see
     li.ss-level-pad in the stylesheet), so there
     is nothing of its own to wrap. */
  if (li.classList.contains("ss-level-pad")) {
    return;
  }
  unwrapDoneOwnSpans(li);
  if (!li.classList.contains("done")) { return; }
  /* Block children stand outside the item's own
     text: a nested list above all, and any block
     the item holds (a table, a code block, a
     figure) keeps its own rendering, exactly as
     the tasks view's completed row strikes only
     its title and never its description. */
  const BREAKERS = { UL: 1, OL: 1, FIGURE: 1,
    TABLE: 1, PRE: 1, DIV: 1, BLOCKQUOTE: 1,
    P: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1,
    H6: 1 };
  let run = [];
  const flush = function () {
    const meaningful = run.some(function (n) {
      return n.nodeType === 1 ||
        (n.nodeValue && n.nodeValue.trim());
    });
    if (run.length && meaningful) {
      const span = document.createElement("span");
      span.className = "ss-done-own";
      li.insertBefore(span, run[0]);
      run.forEach(function (n) {
        span.appendChild(n);
      });
    }
    run = [];
  };
  Array.from(li.childNodes).forEach(function (n) {
    const breaker = n.nodeType === 1 &&
      (BREAKERS[n.tagName] ||
       (n.tagName === "INPUT" &&
        n.type === "checkbox"));
    if (breaker) { flush(); } else { run.push(n); }
  });
  flush();
}

function decorateDoneItems(rootEl) {
  if (!rootEl || !rootEl.querySelectorAll) { return; }
  rootEl.querySelectorAll("li").forEach(
    function (li) { syncDoneItemWrap(li); });
}


/* v2.6.0: the hover tooltip for one anchor in a note body. A note
   link (ssnote:) shows the target note's current title; findNoteById
   looks in the live list, Trash, and the Archive, so a target in
   Trash or the Archive still shows its title, and only a target
   that no longer exists at all falls back to the link's own text.
   A web link shows its own address, exactly as written. Returns an
   empty string when there is nothing sensible to show. */
function linkTooltipFor(anchor) {
  const noteId = noteLinkIdOf(anchor);
  if (noteId) {
    const target = findNoteById(noteId);
    if (target) { return target.title || "Untitled note"; }
    return (anchor.textContent || "").trim();
  }
  return anchor.getAttribute("href") || "";
}

/* v2.6.0: set the title attribute on every link under rootEl, the
   same decoration shape as normalizeChecklists above. renderEditor
   runs this each time a note's body is filled, alongside the
   attachment decoration and the table filter pass, so tooltips are
   always resolved against the notes as they are right now. Titles
   are presentational only: the text and Word exporters read link
   text and addresses, never title attributes, so nothing about a
   tooltip can leak into an export. */
function decorateLinkTooltips(rootEl) {
  if (!rootEl || !rootEl.querySelectorAll) { return; }
  rootEl.querySelectorAll("a[href]").forEach(function (anchor) {
    /* v2.10: a note link's Mention label derivation is captured
       BEFORE the setAttribute below overwrites the saved title
       attribute with the live one; see captureNoteLinkDerivation
       in the link faces block. */
    /* v2.28.0: a task link's title attribute belongs to
       decorateTaskLinks (it is the rename derivation
       record); the tooltip pass leaves it alone. */
    if (taskLinkIdOf(anchor)) { return; }
    /* v2.37.0: a table of contents entry's tooltip would
       be its own fragment address, which tells the reader
       nothing; the pass leaves TOC anchors titleless. */
    if (anchor.closest && anchor.closest(".ss-toc")) { return; }
    /* v2.49.0: and inside a note tasks block, same rule. */
    if (anchor.closest && anchor.closest(".ss-note-tasks")) { return; }
    if (noteLinkIdOf(anchor)) { captureNoteLinkDerivation(anchor); }
    const tip = linkTooltipFor(anchor);
    if (tip) { anchor.setAttribute("title", tip); }
    else { anchor.removeAttribute("title"); }
  });
}

/* The text of a checklist item, not counting the checkbox itself.
   Tells an empty item (Enter leaves the list) from a filled one
   (Enter splits it). */
function checklistItemText(li) {
  let text = "";
  li.childNodes.forEach(function (node) {
    if (node.nodeType === 1 && node.tagName === "INPUT") { return; }
    text += node.textContent || "";
  });
  return text;
}

/* When the caret is a collapsed selection inside a checklist item,
   return { li, ul, range }; otherwise null. Non collapsed selections
   keep the browser default Enter behavior. */
function checklistItemAtCaret() {
  const bodyEl = document.getElementById("noteBody");
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { return null; }
  const range = sel.getRangeAt(0);
  if (!range.collapsed) { return null; }
  if (!bodyEl.contains(range.startContainer)) { return null; }
  let node = range.startContainer;
  if (node.nodeType !== 1) { node = node.parentNode; }
  const li = node && node.closest ? node.closest("li") : null;
  if (!li || !bodyEl.contains(li)) { return null; }
  const ul = li.parentElement;
  if (!isChecklistList(ul)) { return null; }
  return { li: li, ul: ul, range: range };
}

/* Handle Enter (no Shift) with the caret inside a checklist item.
   Returns true when the keypress was handled and the caller must
   preventDefault. The DOM work is done directly, never through
   execCommand insertHTML, so the result is exact:
     - a filled item splits at the caret; the new item below starts
       with a fresh unchecked checkbox and carries whatever content
       was after the caret; the caret lands at its start;
     - an empty item leaves the checklist, becoming a normal
       paragraph where it stood, and items below it stay a checklist
       in a list of their own (the list splits around the paragraph),
       matching how other note apps treat Enter on an empty item. */
function handleChecklistEnter() {
  const hit = checklistItemAtCaret();
  if (!hit) { return false; }
  const li = hit.li;
  const ul = hit.ul;
  const range = hit.range;
  const sel = window.getSelection();

  if (!checklistItemText(li).trim()) {
    const p = document.createElement("p");
    p.appendChild(document.createElement("br"));
    const rest = document.createElement("ul");
    rest.setAttribute("class", ul.getAttribute("class") || "ss-checklist");
    let next = li.nextSibling;
    while (next) {
      const moving = next;
      next = next.nextSibling;
      rest.appendChild(moving);
    }
    li.remove();
    ul.after(p);
    if (rest.childNodes.length) { p.after(rest); }
    if (!ul.querySelector("li")) { ul.remove(); }
    /* v2.24.7: same spacing neutral exit as the toolbar toggle
       (see markChecklistExit). */
    markChecklistExit(p, ul, rest);
    const caret = document.createRange();
    caret.setStart(p, 0);
    caret.collapse(true);
    sel.removeAllRanges();
    sel.addRange(caret);
    markDirty();
    return true;
  }

  /* v2.101.0 (audit D2): the split below takes
     everything from the caret to the item's end as
     the new item's tail, on the assumption that the
     item's checkbox stands before the caret. A caret
     parked ahead of the box (the old conversion left
     it there) put the box itself in the tail: the
     item lost its box and the new item gained a
     second one. The box is moved to the item's head
     first, where it belongs, so no caret position
     inside the item can put it in the tail; and any
     stray box the tail still carried is dropped from
     the new item below, leaving the fresh box the
     only one it holds. */
  const ownBox = Array.prototype.find.call(li.childNodes,
    function (n) {
      return n.nodeType === 1 && n.tagName === "INPUT" &&
        n.type === "checkbox";
    });
  if (ownBox && li.firstChild !== ownBox) {
    li.insertBefore(ownBox, li.firstChild);
  }
  const newLi = document.createElement("li");
  const box = document.createElement("input");
  box.type = "checkbox";
  newLi.appendChild(box);
  const tail = document.createRange();
  tail.setStart(range.startContainer, range.startOffset);
  tail.setEnd(li, li.childNodes.length);
  newLi.appendChild(tail.extractContents());
  li.after(newLi);
  Array.prototype.slice.call(newLi.childNodes)
    .forEach(function (n) {
      if (n !== box && n.nodeType === 1 &&
          n.tagName === "INPUT") {
        n.remove();
      }
    });
  const caret2 = document.createRange();
  caret2.setStartAfter(box);
  caret2.collapse(true);
  sel.removeAllRanges();
  sel.addRange(caret2);
  markDirty();
  return true;
}

/* --------------------------------------------------------------------------
   v2.101.0: the checklist's Backspace, and the plain
   lists' Enter exit. Two list gestures the app left
   to the browser (audit D3 and D5): in front of a
   checklist caret at an item's start, the browser's
   previous deletable unit is the item's checkbox
   itself, so Backspace ate the box and edited
   nothing; and a plain list's exit, left to the
   browser, lands in a div in an app whose blocks are
   paragraphs.
   -------------------------------------------------------------------------- */

/* Backspace with the caret at the very start of a
   checklist item. Returns true when the keypress was
   handled and the caller must preventDefault. The
   shapes:
     - a filled item joins the item above it, the
       bullets' own behavior: its content (its
       checkbox left behind) appends to the previous
       item's own text and the caret lands at the
       junction. The first item of a nested list joins
       the item its list hangs under the same way.
     - an empty item is removed and the caret lands
       at the end of the previous item (or of the item
       its list hangs under), leaving no phantom
       boxless row; at the top level with nothing
       above, it becomes a paragraph ahead of the
       list, the exit shape.
     - the first filled item of a top level list
       becomes a paragraph where it stood, through
       the same conversion the toolbar toggle uses.
   A caret anywhere else in the item keeps the
   browser's Backspace: the box is only ever the
   unit in front of the caret at the item's start,
   which is the one position this handler claims. */
function handleChecklistBackspace() {
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl || bodyEl.contentEditable === "false") {
    return false;
  }
  const hit = checklistItemAtCaret();
  if (!hit) { return false; }
  const li = hit.li;
  const ul = hit.ul;
  const range = hit.range;
  if (caretTextOffsetWithin(li, range) > 0) {
    return false;
  }
  const prev = li.previousElementSibling;
  const prevLi = prev && prev.tagName === "LI" ? prev : null;
  const hostLi = ul.parentElement &&
    ul.parentElement.tagName === "LI" ? ul.parentElement : null;
  if (!checklistItemText(li).trim()) {
    /* An empty item: it goes away, box and all. */
    if (prevLi) {
      li.remove();
      if (!ul.querySelector("li")) { ul.remove(); }
      placeCaretAtItemTextOffset(prevLi,
        itemOwnTextLength(prevLi));
    } else if (hostLi) {
      li.remove();
      if (!ul.querySelector("li")) { ul.remove(); }
      placeCaretAtItemTextOffset(hostLi,
        itemOwnTextLength(hostLi));
    } else {
      const p = document.createElement("p");
      p.appendChild(document.createElement("br"));
      li.remove();
      ul.parentElement.insertBefore(p, ul);
      if (!ul.querySelector("li")) { ul.remove(); }
      markChecklistExit(p, document.createElement("ul"), ul);
      setBodyCaret(p, 0);
    }
    markDirty();
    return true;
  }
  const joinTarget = prevLi || hostLi;
  if (joinTarget) {
    const junction = itemOwnTextLength(joinTarget);
    let insertBefore = null;
    if (joinTarget === hostLi) {
      insertBefore = ul;
    } else {
      for (let i = 0; i < joinTarget.childNodes.length; i++) {
        const n = joinTarget.childNodes[i];
        if (n.nodeType === 1 &&
            (n.tagName === "UL" || n.tagName === "OL")) {
          insertBefore = n;
          break;
        }
      }
    }
    /* Everything but the checkbox moves up: the moved
       text joins the target's own line, ahead of any
       sublist it carries. */
    while (li.firstChild) {
      const child = li.firstChild;
      if (child.nodeType === 1 && child.tagName === "INPUT" &&
          child.type === "checkbox") {
        li.removeChild(child);
      } else if (insertBefore) {
        joinTarget.insertBefore(child, insertBefore);
      } else {
        joinTarget.appendChild(child);
      }
    }
    li.remove();
    if (!ul.querySelector("li")) { ul.remove(); }
    placeCaretAtItemTextOffset(joinTarget, junction);
    markDirty();
    return true;
  }
  checklistItemToParagraph(li, ul);
  markDirty();
  return true;
}

/* Enter on the empty last item of a bullet or
   numbered list: the item leaves the list and a
   fresh paragraph stands after the list for the
   caret (audit D5: the browser's own exit lands in
   a div, and a div is a second class block in this
   app). An empty last item of a NESTED list promotes
   one level instead, the word processor behavior;
   the next Enter, at the top level, exits. Every
   other Enter in a plain list (a filled item
   anywhere, an empty item with items below it)
   keeps the browser default, which the audit found
   clean. Returns true when handled. */
function handlePlainListEnter() {
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl || bodyEl.contentEditable === "false") {
    return false;
  }
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { return false; }
  const range = sel.getRangeAt(0);
  if (!range.collapsed) { return false; }
  if (!bodyEl.contains(range.startContainer)) {
    return false;
  }
  const li = listItemOfNode(range.startContainer);
  if (!li) { return false; }
  const list = li.parentElement;
  if (!list || (list.tagName !== "UL" &&
                list.tagName !== "OL")) {
    return false;
  }
  if (isChecklistList(list)) { return false; }
  if (li.nextElementSibling) { return false; }
  if (li.querySelector("ul, ol")) { return false; }
  const ownText = itemOwnTextNodes(li).map(function (n) {
    return n.nodeValue;
  }).join("");
  if (ownText.trim()) { return false; }
  const host = list.parentElement;
  if (host && host.tagName === "LI") {
    if (!outdentListItem(li)) { return false; }
    placeCaretAtItemTextOffset(li, 0);
    markDirty();
    return true;
  }
  if (host !== bodyEl) { return false; }
  const p = document.createElement("p");
  p.appendChild(document.createElement("br"));
  li.remove();
  list.after(p);
  if (!list.querySelector("li")) { list.remove(); }
  setBodyCaret(p, 0);
  markDirty();
  return true;
}

/* --------------------------------------------------------------------------
   v1.3 formatting engine: selection preservation, styled span helpers,
   color palettes, dropdown menus, and the Insert and More actions.

   Persistence rule (the reason for the custom helpers): anything the
   toolbar applies must survive as inline CSS styles inside the saved
   note body HTML, so a formatted note renders identically from Drive
   on any device. That means styled spans such as
   <span style="font-size: 14pt"> and never <font> tags. wireToolbar
   switches the editor to styleWithCSS mode so the foreColor and
   hiliteColor commands emit styled spans too. Font size cannot use the
   execCommand fontSize command (it only accepts legacy sizes 1 to 7),
   so size and family share one tested helper that wraps the selected
   text nodes in a span carrying the exact CSS value.
   -------------------------------------------------------------------------- */

/* Font stacks behind the family picker keys. The generic families at
   the end of each stack keep the app dependency free: no web fonts are
   downloaded, every device uses its own closest match. v2.6.0: the
   picker grew from the four generic entries to seventeen named stacks;
   the original four are unchanged, so notes already using them keep
   rendering exactly as before. */
const FONT_STACKS = {
  sans: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, " +
        "\"Helvetica Neue\", Arial, sans-serif",
  system: "system-ui, -apple-system, BlinkMacSystemFont, " +
        "\"Segoe UI\", Roboto, sans-serif",
  verdana: "Verdana, Geneva, Tahoma, sans-serif",
  tahoma: "Tahoma, Geneva, Verdana, sans-serif",
  trebuchet: "\"Trebuchet MS\", \"Lucida Grande\", " +
        "\"Lucida Sans Unicode\", sans-serif",
  calibri: "Calibri, Candara, \"Segoe UI\", sans-serif",
  serif: "Georgia, \"Times New Roman\", Times, serif",
  georgia: "Georgia, \"Times New Roman\", Times, serif",
  palatino: "\"Palatino Linotype\", \"Book Antiqua\", Palatino, " +
        "Georgia, serif",
  garamond: "Garamond, \"EB Garamond\", \"Times New Roman\", serif",
  cambria: "Cambria, Georgia, \"Times New Roman\", serif",
  times: "\"Times New Roman\", Times, serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, " +
        "\"Liberation Mono\", monospace",
  consolas: "Consolas, \"Liberation Mono\", Menlo, monospace",
  cascadia: "\"Cascadia Code\", Consolas, \"Liberation Mono\", " +
        "monospace",
  courier: "\"Courier New\", Courier, monospace",
  hand: "\"Segoe Script\", \"Bradley Hand\", \"Comic Sans MS\", cursive"
};

/* Shared swatch palette for the text color and highlight popups: the
   neutrals, the four Deep Forest greens, then the accent hues. */
const TB_COLORS = [
  { name: "Black", value: "#000000" },
  { name: "Dark gray", value: "#444444" },
  { name: "Gray", value: "#888888" },
  { name: "White", value: "#FFFFFF" },
  { name: "Deep forest", value: "#0B3D2E" },
  { name: "Forest green", value: "#14532D" },
  { name: "Leaf green", value: "#2E7D4F" },
  { name: "Accent green", value: "#57A773" },
  { name: "Red", value: "#C0392B" },
  { name: "Orange", value: "#E67E22" },
  { name: "Blue", value: "#2471A3" },
  { name: "Purple", value: "#7D3C98" }
];

/* ----- selection preservation -------------------------------------------
   savedFormatRange is the formatting counterpart of the attachment
   caret memory above. A document level selectionchange listener keeps
   it current whenever the caret or selection is inside the note body,
   and the toolbar also saves on mousedown and focusin as a backstop.
   Restoring it before a command runs is what lets dropdowns, menus,
   and color popups work without losing the user's selected text. */
let savedFormatRange = null;

function saveFormatSelection() {
  const bodyEl = document.getElementById("noteBody");
  const sel = window.getSelection();
  if (sel && sel.rangeCount && bodyEl.contains(sel.anchorNode)) {
    savedFormatRange = sel.getRangeAt(0).cloneRange();
  }
}

/* Put the saved selection back into the editor and focus the body.
   Returns false (leaving focus in the body with no selection) when
   there is no usable saved range, for example after the note changed. */
function restoreFormatSelection() {
  const bodyEl = document.getElementById("noteBody");
  bodyEl.focus();
  if (savedFormatRange &&
      bodyEl.contains(savedFormatRange.startContainer) &&
      bodyEl.contains(savedFormatRange.endContainer)) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedFormatRange.cloneRange());
    return true;
  }
  return false;
}

/* ----- styled span helpers ----------------------------------------------
   wrapRangeTextWithSpan wraps every text node touched by the range in
   its own span carrying the given CSS properties. Wrapping per text
   node (splitting boundary nodes first) is the robust route: unlike
   surroundContents it also works when the selection crosses paragraph
   or list boundaries, and it deliberately skips attachment
   placeholders, whose markup is managed by the attachment code. */
function wrapRangeTextWithSpan(range, styleProps) {
  const bodyEl = document.getElementById("noteBody");
  const walker = document.createTreeWalker(bodyEl, NodeFilter.SHOW_TEXT, null);
  const targets = [];
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    const inAttachment = parent && parent.closest(".ss-attachment");
    if (!inAttachment && node.nodeValue.length &&
        range.intersectsNode(node)) {
      targets.push(node);
    }
    node = walker.nextNode();
  }
  let firstSpan = null;
  let lastSpan = null;
  targets.forEach(function (textNode) {
    let start = 0;
    let end = textNode.nodeValue.length;
    if (textNode === range.startContainer) { start = range.startOffset; }
    if (textNode === range.endContainer) { end = range.endOffset; }
    if (start >= end) { return; }
    let mid = textNode;
    if (start > 0) { mid = textNode.splitText(start); }
    if (end - start < mid.nodeValue.length) { mid.splitText(end - start); }
    const span = document.createElement("span");
    Object.keys(styleProps).forEach(function (key) {
      span.style[key] = styleProps[key];
    });
    mid.parentNode.replaceChild(span, mid);
    span.appendChild(mid);
    if (!firstSpan) { firstSpan = span; }
    lastSpan = span;
  });
  return { first: firstSpan, last: lastSpan };
}

/* After wrapping, put the selection back over the wrapped text so the
   user sees exactly what changed and can keep formatting it. */
function reselectWrapped(wrapped) {
  if (!wrapped.first || !wrapped.last) { return; }
  const sel = window.getSelection();
  const range = document.createRange();
  range.setStart(wrapped.first, 0);
  range.setEnd(wrapped.last, wrapped.last.childNodes.length);
  sel.removeAllRanges();
  sel.addRange(range);
}

/* Collapsed caret case for the span helpers: insert a span holding a
   zero width space and park the caret right after it, so the text the
   user types next inherits the span's styles. */
function insertStyledCaretSpan(styleProps) {
  const bodyEl = document.getElementById("noteBody");
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { return; }
  const range = sel.getRangeAt(0);
  if (!bodyEl.contains(range.commonAncestorContainer)) { return; }
  const span = document.createElement("span");
  Object.keys(styleProps).forEach(function (key) {
    span.style[key] = styleProps[key];
  });
  span.appendChild(document.createTextNode("\u200B"));
  range.insertNode(span);
  const inner = document.createRange();
  inner.setStart(span.firstChild, 1);
  inner.collapse(true);
  sel.removeAllRanges();
  sel.addRange(inner);
}

/* Apply CSS properties to the current selection, whichever of the two
   shapes it has. Shared by font family, font size, and the default
   color reset, so all three behave identically. */
function applySpanStyle(styleProps) {
  restoreFormatSelection();
  const bodyEl = document.getElementById("noteBody");
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { return; }
  const range = sel.getRangeAt(0);
  if (!bodyEl.contains(range.commonAncestorContainer)) { return; }
  if (range.collapsed) {
    insertStyledCaretSpan(styleProps);
  } else {
    reselectWrapped(wrapRangeTextWithSpan(range, styleProps));
  }
  markDirty();
}

function applyFontFamily(key) {
  const stack = FONT_STACKS[key];
  if (!stack) { return; }
  applySpanStyle({ fontFamily: stack });
}

function applyFontSize(pt) {
  if (!pt) { return; }
  applySpanStyle({ fontSize: pt + "pt" });
}

/* ----- colors -------------------------------------------------------------
   Text color goes through foreColor (styled spans, thanks to
   styleWithCSS) with the span helper as a fallback. The Default color
   reset cannot be an execCommand value, so it wraps the selection in a
   span with color: inherit, which renders in the note's own text color
   on every device and stays removable by Remove formatting. */
function applyTextColor(value, opts) {
  restoreFormatSelection();
  if (value === "inherit") {
    applySpanStyle({ color: "inherit" });
  } else {
    let ok = false;
    try { ok = document.execCommand("foreColor", false, value); }
    catch (err) { ok = false; }
    if (!ok) { applySpanStyle({ color: value }); }
  }
  document.getElementById("textColorBar").style.background =
    value === "inherit" ? "" : value;
  /* v2.24.2: the Custom color flow passes keepMenus while its
     picker is open, so the menu holding the picker input is
     never hidden mid-pick. Every other caller closes as
     before. */
  if (!opts || !opts.keepMenus) { closeToolbarMenus(); }
  markDirty();
}

/* Highlight: hiliteColor is the modern command name; backColor is the
   older alias some engines still use, and the span helper is the final
   fallback. "No highlight" passes transparent, which clears the visual
   highlight while keeping the text itself untouched.

   v2.13.1: the command chain's return values are no longer the last
   word. On the Custom color path the range being painted is one this
   file restored programmatically after the native color dialog
   closed, and on exactly that path Edge's hiliteColor can report
   success while painting nothing, so the span fallback (which ran
   only when both commands reported failure) never got its turn and
   the picked color silently did nothing; the preset swatches were
   unaffected because they apply onto a live selection the editor
   never lost. After the chain runs, every non-transparent apply now
   verifies its own effect (ensureHighlightLanded below): if no
   visible background actually landed on the range, the span helper
   runs after all, so a highlight the user asked for is guaranteed by
   the proven path. A range that really was painted verifies clean
   and gains no second span layer. */
function applyHighlight(value, opts) {
  restoreFormatSelection();
  let ok = false;
  try { ok = document.execCommand("hiliteColor", false, value); }
  catch (err) { ok = false; }
  if (!ok) {
    try { ok = document.execCommand("backColor", false, value); }
    catch (err) { ok = false; }
  }
  if (!ok) { applySpanStyle({ backgroundColor: value }); }
  if (value !== "transparent") { ensureHighlightLanded(value); }
  document.getElementById("highlightBar").style.background =
    value === "transparent" ? "" : value;
  /* v2.24.2: keepMenus, as in applyTextColor above. */
  if (!opts || !opts.keepMenus) { closeToolbarMenus(); }
  markDirty();
}

/* v2.13.1: is this background value an actual visible color? "No
   background" is spelled several ways across engines (empty,
   transparent, and the fully transparent rgba form computed styles
   report), and all of them count as no background here. */
function backgroundValueIsVisible(value) {
  if (!value) { return false; }
  const v = String(value).toLowerCase().replace(/\s+/g, "");
  return v !== "" && v !== "transparent" &&
    v !== "rgba(0,0,0,0)" && v !== "rgb(0,0,0,0)";
}

/* v2.13.1: does this element itself carry a visible background? The
   inline style is read first (the form spanHasBackground reads),
   then the computed style, which is what catches a background an
   engine applied through a generated class or a presentational
   element rather than an inline style. */
function elementHasVisibleBackground(el) {
  if (el.style &&
      (backgroundValueIsVisible(el.style.backgroundColor) ||
       backgroundValueIsVisible(el.style.background))) {
    return true;
  }
  let computed = "";
  try { computed = window.getComputedStyle(el).backgroundColor; }
  catch (err) { computed = ""; }
  return backgroundValueIsVisible(computed);
}

/* v2.13.1: does any text the range covers sit inside an element
   carrying a visible background? The walk mirrors
   wrapRangeTextWithSpan: text nodes the range touches (boundary
   nodes counted only for the part inside the range), attachment
   placeholders skipped, and each covered node's ancestors are read
   up to but not including the note body itself, whose own
   background is the editor surface, not a highlight. */
function rangeHasVisibleBackground(range) {
  const bodyEl = document.getElementById("noteBody");
  if (!range || range.collapsed) { return false; }
  if (!bodyEl.contains(range.commonAncestorContainer)) { return false; }
  const walker = document.createTreeWalker(
    bodyEl, NodeFilter.SHOW_TEXT, null);
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    const inAttachment = parent && parent.closest(".ss-attachment");
    if (!inAttachment && node.nodeValue.length &&
        range.intersectsNode(node)) {
      let start = 0;
      let end = node.nodeValue.length;
      if (node === range.startContainer) { start = range.startOffset; }
      if (node === range.endContainer) { end = range.endOffset; }
      if (start < end) {
        let el = parent;
        while (el && el !== bodyEl) {
          if (elementHasVisibleBackground(el)) { return true; }
          el = el.parentElement;
        }
      }
    }
    node = walker.nextNode();
  }
  return false;
}

/* v2.13.1: the range a just finished highlight apply is judged on:
   the live selection when it is still a real range inside the body,
   else the saved format range the apply restored from. A collapsed
   or missing range yields null: there is nothing to judge, and
   nothing to repaint. */
function highlightJudgeRange() {
  const bodyEl = document.getElementById("noteBody");
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const live = sel.getRangeAt(0);
    if (!live.collapsed &&
        bodyEl.contains(live.commonAncestorContainer)) {
      return live;
    }
  }
  if (savedFormatRange && !savedFormatRange.collapsed &&
      bodyEl.contains(savedFormatRange.startContainer) &&
      bodyEl.contains(savedFormatRange.endContainer)) {
    return savedFormatRange;
  }
  return null;
}

/* v2.13.1: applyHighlight's guarantee, described at its definition:
   when the command chain left no visible background on the range it
   acted on, the span helper applies the color itself. */
function ensureHighlightLanded(value) {
  const range = highlightJudgeRange();
  if (!range) { return; }
  if (!rangeHasVisibleBackground(range)) {
    applySpanStyle({ backgroundColor: value });
  }
}

/* ----- the Custom color flow (v2.24.2) -------------------------------------
   Chris's contract for both palettes' Custom row: clicking
   Custom paints the selection at once with the current
   custom color, and the same click opens the native picker;
   while the picker is open, its input ticks repaint the
   same text live; when the picker commits (its change
   event), the final color stands and is remembered; a
   dismissal with no picker events leaves the at-click
   color standing.

   The flow this replaces applied only on change, over the
   saved format range. That range is kept current by
   listeners that accept any selection anchored in the body,
   collapsed carets included, so a browser that collapses
   the editor selection while the native dialog holds focus
   (the Edge behavior behind Chris's report, and the reason
   v2.13.1 needed its verifier) overwrote the saved range
   with a collapsed caret, and the change-time apply then
   painted nothing at all. This flow therefore works over
   its own bookmark: a clone of the selection taken
   synchronously at the Custom click, before the picker
   can disturb anything, the way the paste popup bookmarks
   its range. Every application pins the saved format range
   from the bookmark first, so nothing the dialog does to
   the live selection or the saved range can move the
   paint, and after each application the bookmark is
   recaptured from the selection the apply leaves over the
   painted text (the span helpers reselect their wraps, and
   a painting engine leaves the selection over its own
   paint), which keeps the bookmark valid across the node
   splits a wrap performs. */
let customColorSession = null;

/* Recolor, in place, the spans an earlier application in
   this session painted over the bookmarked range, and
   report whether any were found. The walk mirrors
   wrapRangeTextWithSpan (boundary text nodes counted only
   for the part inside the range, attachment placeholders
   skipped), and for each covered text node only the
   NEAREST ancestor span carrying the session's property is
   recolored: that is the span the earlier application
   painted, and stopping there leaves a wider span that
   extends past the selection (a highlight the selection
   only partly covers) untouched on its outside text.
   Recoloring in place is what lets a picker tick follow
   the user's eye without stacking a fresh span layer per
   tick. */
function repaintCustomSpans(session, value) {
  const bodyEl = document.getElementById("noteBody");
  const range = session.range;
  if (!range || range.collapsed ||
      !bodyEl.contains(range.commonAncestorContainer)) {
    return false;
  }
  const prop = session.kind === "highlight" ? "backgroundColor" : "color";
  const walker = document.createTreeWalker(
    bodyEl, NodeFilter.SHOW_TEXT, null);
  const spans = [];
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    const inAttachment = parent && parent.closest(".ss-attachment");
    if (!inAttachment && node.nodeValue.length &&
        range.intersectsNode(node)) {
      let start = 0;
      let end = node.nodeValue.length;
      if (node === range.startContainer) { start = range.startOffset; }
      if (node === range.endContainer) { end = range.endOffset; }
      if (start < end) {
        let el = parent;
        while (el && el !== bodyEl) {
          if (el.tagName === "SPAN" && el.style &&
              (prop === "backgroundColor"
                ? (el.style.backgroundColor || el.style.background)
                : el.style.color)) {
            if (spans.indexOf(el) === -1) { spans.push(el); }
            break;
          }
          el = el.parentElement;
        }
      }
    }
    node = walker.nextNode();
  }
  spans.forEach(function (span) { span.style[prop] = value; });
  return spans.length > 0;
}

/* One application of a value inside a Custom session: pin
   the bookmark into the saved format range, recolor the
   already painted spans when there are any (the live tick
   path), and otherwise run the palette's own apply (the
   first application, or a tick whose paint is not found).
   The toolbar menus stay open throughout: the picker is
   up, and hiding the menu would hide the input it is
   anchored to. */
function applyCustomColor(session, value) {
  if (session.range) {
    savedFormatRange = session.range.cloneRange();
  }
  let painted = false;
  if (session.appliedValue !== null && session.range) {
    painted = repaintCustomSpans(session, value);
    if (painted) {
      document.getElementById(
        session.kind === "highlight" ? "highlightBar" : "textColorBar"
      ).style.background = value;
      markDirty();
    }
  }
  if (!painted) {
    if (session.kind === "highlight") {
      applyHighlight(value, { keepMenus: true });
    } else {
      applyTextColor(value, { keepMenus: true });
    }
  }
  session.appliedValue = value;
  /* Recapture the bookmark from the selection the apply
     left over the painted text, when that selection is a
     usable range inside the body. The repaint path never
     moves the live selection, so a dialog-collapsed caret
     simply keeps the previous bookmark. */
  const bodyEl = document.getElementById("noteBody");
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const live = sel.getRangeAt(0);
    if (!live.collapsed &&
        bodyEl.contains(live.commonAncestorContainer)) {
      session.range = live.cloneRange();
    }
  }
}

/* The Custom click: bookmark the selection exactly as it
   stands, then paint with the input's current value. The
   bookmark, the part the dialog could destroy, is captured
   synchronously here; the paint itself is deferred one
   tick so the click's own activation behavior (opening
   the native picker) is never preceded by the focus and
   DOM changes an application performs. */
function beginCustomColor(kind, input) {
  saveFormatSelection();
  const bodyEl = document.getElementById("noteBody");
  let range = null;
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const live = sel.getRangeAt(0);
    if (!live.collapsed &&
        bodyEl.contains(live.commonAncestorContainer)) {
      range = live.cloneRange();
    }
  }
  if (!range && savedFormatRange &&
      bodyEl.contains(savedFormatRange.startContainer) &&
      bodyEl.contains(savedFormatRange.endContainer)) {
    range = savedFormatRange.cloneRange();
  }
  customColorSession = {
    kind: kind, input: input, range: range, appliedValue: null
  };
  const session = customColorSession;
  setTimeout(function () {
    if (customColorSession === session) {
      applyCustomColor(session, input.value);
    }
  }, 0);
}

/* The picker's input ticks repaint live over the bookmark.
   A tick with no live session cannot occur (the picker
   opens only from the click that begins one), and one that
   somehow slips through is ignored rather than painting
   over whatever selection happens to be live. */
function customColorInput(kind, input) {
  const session = customColorSession;
  if (!session || session.input !== input) { return; }
  applyCustomColor(session, input.value);
}

/* Remember a committed pick: the state value loadSettings
   restores and the toolbar wiring seeds into the input,
   so the next Custom click, in this session or after a
   reload, starts from it. */
function rememberCustomColor(kind, value) {
  if (!/^#[0-9a-fA-F]{6}$/.test(value || "")) { return; }
  if (kind === "highlight") {
    state.customHighlightColor = value.toLowerCase();
  } else {
    state.customTextColor = value.toLowerCase();
  }
  saveSettings();
}

/* The picker's change event: the picker has closed with a
   committed value. With a live session, apply the value
   over the bookmark unless the live ticks already painted
   exactly it (the common case, where a second application
   could only stack paint), remember it either way, and
   hand focus and the selection back to the editor; the
   final apply closes the toolbar menus, matching the
   flow's old end state. A change with no session (this
   event was the palette's only entry point before
   v2.24.2) applies and remembers plainly. */
function commitCustomColor(kind, input) {
  const session = customColorSession;
  if (!session || session.input !== input) {
    if (kind === "highlight") { applyHighlight(input.value); }
    else { applyTextColor(input.value); }
    rememberCustomColor(kind, input.value);
    return;
  }
  customColorSession = null;
  if (session.range) {
    savedFormatRange = session.range.cloneRange();
  }
  if (session.appliedValue !== input.value) {
    if (kind === "highlight") { applyHighlight(input.value); }
    else { applyTextColor(input.value); }
  } else {
    restoreFormatSelection();
  }
  rememberCustomColor(kind, input.value);
}

/* v2.6.0: split el around one of its child nodes: el keeps the child,
   and clones of el (same tag, same attributes) take the siblings
   before and after it, inserted as el's own siblings. Returns el.
   The clones carry el's styling, which is exactly what background
   removal needs: the parts outside the selection keep their
   background, the part inside can be stripped on its own. */
function splitElementAroundChild(el, child) {
  const parent = el.parentNode;
  if (!parent || !el.contains(child)) { return el; }
  const before = el.cloneNode(false);
  const after = el.cloneNode(false);
  const beforeNodes = [];
  const afterNodes = [];
  let seen = false;
  let sib = el.firstChild;
  while (sib) {
    const next = sib.nextSibling;
    if (sib === child) { seen = true; }
    else if (!seen) { beforeNodes.push(sib); }
    else { afterNodes.push(sib); }
    sib = next;
  }
  beforeNodes.forEach(function (x) { before.appendChild(x); });
  afterNodes.forEach(function (x) { after.appendChild(x); });
  if (before.childNodes.length) { parent.insertBefore(before, el); }
  if (after.childNodes.length) {
    parent.insertBefore(after, el.nextSibling);
  }
  return el;
}

/* v2.6.0: narrow span so it covers only the branch that contains
   node: every element on the path from span down to node is split
   around the piece below it, deepest level first, so when the span
   itself is split (last) the piece it keeps holds exactly node's
   branch. The pieces split off keep the span's attributes and stay
   in the document as its siblings. */
function splitSpanAround(span, node) {
  const path = [];
  let n = node;
  while (n && n !== span) { path.unshift(n); n = n.parentNode; }
  if (n !== span) { return span; }
  for (let i = path.length - 1; i >= 0; i--) {
    const el = i === 0 ? span : path[i - 1];
    splitElementAroundChild(el, path[i]);
  }
  return span;
}

/* v2.6.0: does this span carry a background in its inline style?
   Checks the parsed properties and falls back to a text search of
   the style attribute, so a background written as the shorthand is
   caught too. */
function spanHasBackground(span) {
  if (!span.style) { return false; }
  if (span.style.backgroundColor || span.style.background) {
    return true;
  }
  return (span.getAttribute("style") || "")
    .toLowerCase().indexOf("background") !== -1;
}

/* v2.18: remove the background styling from ONE element: the
   background shorthand and every background-* declaration in
   its inline style, plus the bgcolor attribute. Every other
   declaration (font, size, color, margins) is preserved word
   for word, and a style attribute the cleaning empties is
   removed outright. The declaration filter works on the
   attribute text rather than the CSSOM, so exactly the same
   cleaning happens in every engine: this is the fix for
   Chris's email pastes, whose white background rides on the
   pasted paragraphs themselves, where neither removeFormat
   nor the highlight clearer ever reaches. */
function cleanBackgroundFromElement(el) {
  if (!el || el.nodeType !== 1) { return; }
  if (el.hasAttribute && el.hasAttribute("bgcolor")) {
    el.removeAttribute("bgcolor");
  }
  const style = el.getAttribute ? el.getAttribute("style") : null;
  if (!style || style.toLowerCase().indexOf("background") === -1) {
    return;
  }
  const kept = [];
  style.split(";").forEach(function (decl) {
    const text = decl.trim();
    if (!text) { return; }
    const colon = text.indexOf(":");
    const prop = (colon === -1 ? text : text.slice(0, colon))
      .trim().toLowerCase();
    if (prop === "background" || prop.indexOf("background-") === 0) {
      return;
    }
    kept.push(text);
  });
  if (kept.length) {
    el.setAttribute("style", kept.join("; ") + ";");
  } else {
    el.removeAttribute("style");
  }
}

/* v2.18: clean every element in a list of roots, each root and
   all its descendants. Elements inside an attachment block
   are skipped: an attachment's faces are runtime furniture
   rebuilt on every render, never saved styling, and a paste
   or a clear that carried one along must not reach inside
   it. Shared by the paste sanitizer and the clear formatting
   cure below. */
function cleanBackgroundsInRoots(roots) {
  (roots || []).forEach(function (root) {
    if (!root || root.nodeType !== 1) { return; }
    if (root.closest && root.closest(".ss-attachment")) { return; }
    /* v2.37.0: a TOC block's subtree is skipped too, like
       an attachment's (it carries no background styles of
       its own; the skip keeps the rule uniform). */
    if (root.closest && root.closest(".ss-toc")) { return; }
    /* v2.49.0: a note tasks block's subtree is skipped
       too, on the same rule: generated content, painted
       live, carrying no background styling of its own. */
    if (root.closest && root.closest(".ss-note-tasks")) { return; }
    /* v2.116: a mail or event chip's subtree is skipped
       on the same rule: the chip is an atomic island the
       app itself built, and its one styled interior (the
       event chip's calendar color dot) is the chip's
       face, not source styling. Through v2.115 a pasted
       event chip lost its dot's color right here, in
       the background strip, and landed colorless beside
       the picker planted chip it should have matched. */
    if (root.closest && root.closest(".ss-mail-chip")) { return; }
    if (root.closest && root.closest(".ss-event-chip")) { return; }
    cleanBackgroundFromElement(root);
    root.querySelectorAll("*").forEach(function (el) {
      if (el.closest && el.closest(".ss-attachment")) { return; }
      if (el.closest && el.closest(".ss-toc")) { return; }
      if (el.closest && el.closest(".ss-note-tasks")) { return; }
      if (el.closest && el.closest(".ss-mail-chip")) { return; }
      if (el.closest && el.closest(".ss-event-chip")) { return; }
      cleanBackgroundFromElement(el);
    });
  });
}

/* v2.18: the paste time half of the background fix. An HTML
   fragment from the clipboard (an email client's paragraphs
   above all) is parsed into a detached holder, every element
   in it is cleaned of background styling, and the cleaned
   fragment is what the paste handler inserts. Everything
   else about the paste (fonts, sizes, bold, links, tables)
   passes through exactly as it arrived. */
function stripPastedBackgrounds(htmlText) {
  const holder = document.createElement("div");
  holder.innerHTML = htmlText;
  /* The holder's children are the fragment's top level
     elements; as roots they carry every nested element with
     them, so this one walk covers the whole fragment. */
  cleanBackgroundsInRoots(
    Array.prototype.slice.call(holder.children));
  return holder.innerHTML;
}

/* ------------------------------------------------------------------
   v2.23: MERGE FORMATTING, the middle paste mode. Same document
   structure as the source paste (paragraphs, divs, headings,
   lists, blockquotes, tables, checklists, links, and the
   bold/italic/underline elements all stay), with the inline
   presentation that pins text to its source look removed, so
   the pasted text adopts the note's own formatting. The strip
   rule set, grounded in the v2.18 cleaner above and worked by
   the same declaration-text filter so it behaves identically
   in every engine:
     - style declarations whose property is font,
       font-family, font-size, color, background, or any
       background-* property, plus the WebKit text fill and
       stroke colors some mail clients ride on;
     - the legacy presentational attributes face, size,
       color, and bgcolor.
   What is NOT stripped: font-weight, font-style,
   text-decoration, margins, line height, alignment, table
   geometry, class names, and every element itself, so the
   structure and the emphasis semantics survive whole.
   Attachment blocks are skipped, exactly as in the background
   cleaner: their faces are runtime furniture, not styling.
   ------------------------------------------------------------------ */
const MERGE_STRIPPED_STYLE_PROPS = {
  "font": true,
  "font-family": true,
  "font-size": true,
  "color": true,
  "background": true,
  "-webkit-text-fill-color": true,
  "-webkit-text-stroke-color": true
};

function mergeStripStyleAttribute(style) {
  const kept = [];
  style.split(";").forEach(function (decl) {
    const text = decl.trim();
    if (!text) { return; }
    const colon = text.indexOf(":");
    const prop = (colon === -1 ? text : text.slice(0, colon))
      .trim().toLowerCase();
    if (MERGE_STRIPPED_STYLE_PROPS[prop]) { return; }
    if (prop.indexOf("background-") === 0) { return; }
    kept.push(text);
  });
  return kept.length ? kept.join("; ") + ";" : "";
}

function cleanMergeFromElement(el) {
  if (!el || el.nodeType !== 1) { return; }
  ["face", "size", "color", "bgcolor"].forEach(function (attr) {
    if (el.hasAttribute && el.hasAttribute(attr)) {
      el.removeAttribute(attr);
    }
  });
  const style = el.getAttribute ? el.getAttribute("style") : null;
  if (!style) { return; }
  const next = mergeStripStyleAttribute(style);
  if (next) {
    el.setAttribute("style", next);
  } else {
    el.removeAttribute("style");
  }
}

/* The merge walk over a list of roots, mirroring
   cleanBackgroundsInRoots exactly, attachment skip included.
   v2.116: the chip skip rides along too, on the same
   ground: a chip's interiors are the app's own face for
   an atomic island, not the source's presentation, and
   merge formatting has no business recoloring them. */
function cleanMergeInRoots(roots) {
  (roots || []).forEach(function (root) {
    if (!root || root.nodeType !== 1) { return; }
    if (root.closest && root.closest(".ss-attachment")) { return; }
    if (root.closest && root.closest(".ss-mail-chip")) { return; }
    if (root.closest && root.closest(".ss-event-chip")) { return; }
    cleanMergeFromElement(root);
    root.querySelectorAll("*").forEach(function (el) {
      if (el.closest && el.closest(".ss-attachment")) { return; }
      if (el.closest && el.closest(".ss-mail-chip")) { return; }
      if (el.closest && el.closest(".ss-event-chip")) { return; }
      cleanMergeFromElement(el);
    });
  });
}

/* The merge rendering of a clipboard HTML fragment: parsed
   into the same detached holder as the source rendering, the
   v2.18 background cleaning runs first (backgrounds are gone
   in every mode), then the merge walk strips the rest of the
   source presentation. */
function mergePastedFormatting(htmlText) {
  const holder = document.createElement("div");
  holder.innerHTML = htmlText;
  const roots = Array.prototype.slice.call(holder.children);
  cleanBackgroundsInRoots(roots);
  cleanMergeInRoots(roots);
  return holder.innerHTML;
}

/* ------------------------------------------------------------------
   v2.23: THE PASTE OPTIONS POPUP. When a paste carrying HTML
   lands (the only paste the handler intercepts), the raw
   clipboard payloads and the pasted range are retained in a
   session, and this card appears at the end of the pasted
   content with the three modes and a Set default paste row.
   Picking a mode re-applies the paste in that mode, in place,
   through the very insertHTML call the paste itself used, so
   the save funnel sees the final content exactly as if it had
   been pasted that way.

   The session holds live-node bookmarks, never serialized
   HTML: start (the caret the paste landed at) and end (the
   caret the insert left behind). Insertion never replaces the
   node the caret sat in, so both bookmarks stay valid for the
   whole session. Anything that could move them (typing, a
   click elsewhere, a note switch) dismisses the popup first,
   which is what makes the bookmarks and the undo composition
   below safe.

   Undo composition: a switch first undoes the insert the
   editor is currently wearing (one native undo step, the
   same stack the paste itself made) and then inserts the
   new rendering as a fresh step. So the session never grows
   the stack: paste makes step A; a switch undoes A and
   makes step B; a second switch undoes B and makes step C.
   One Ctrl+Z after any switch removes the current insert
   step and lands on the pre-paste content, exactly as one
   Ctrl+Z after the paste itself would. Where execCommand
   undo is unavailable or reports failure, the switch falls
   back to selecting the bookmarked pasted range and
   inserting over it; then one Ctrl+Z returns to the paste
   as it last landed, and a second reaches the pre-paste
   state.
   ------------------------------------------------------------------ */
let pastePopupSession = null;   // {html, text, mode, start, end, fresh?}
let pastePopupApplying = false; // true while a switch re-inserts

/* The editor element, fetched per call: the app's own
   noteBodyEl binding is local to wireEvents, so this block
   (like the save funnel and the caret helpers) goes through
   the document. */
function pasteBodyEl() { return document.getElementById("noteBody"); }

function pastePopupOpen() {
  const popup = document.getElementById("pastePopup");
  return !!popup && !popup.classList.contains("hidden");
}

/* Close the popup and drop the retained payloads. Every
   dismissal route funnels here; it never touches the editor,
   so whatever rendering was last applied simply stays. */
function closePastePopup() {
  pastePopupSession = null;
  const popup = document.getElementById("pastePopup");
  if (popup) { popup.classList.add("hidden"); }
}

/* One rendering of the retained payloads, per mode. Source is
   the v2.18 pipeline untouched; text follows the app's plain
   text convention (textToNoteBodyHtml: blank lines split
   paragraphs, single line breaks become line breaks). */
function renderPasteForMode(mode, htmlText, plainText) {
  if (mode === "merge") { return mergePastedFormatting(htmlText); }
  if (mode === "text") { return textToNoteBodyHtml(plainText || ""); }
  return stripPastedBackgrounds(htmlText);
}

/* Mark the row for the session's current mode. The applied
   choice is drawn (soft fill plus the check), never silently
   remembered, per Chris's settings rule. */
function syncPastePopupRows() {
  const popup = document.getElementById("pastePopup");
  if (!popup || !pastePopupSession) { return; }
  popup.querySelectorAll("[data-paste-mode]").forEach(function (row) {
    const on = row.getAttribute("data-paste-mode") === pastePopupSession.mode;
    row.classList.toggle("current", on);
    row.setAttribute("aria-checked", on ? "true" : "false");
  });
}

/* Park the popup at the end of the pasted content: under the
   end bookmark's caret rectangle, flipped above it when the
   card would run off the window's bottom and clamped inside
   the window horizontally, the mention popup's geometry. The
   end bookmark node may be an element (offset = child index)
   or a text node; the rect comes from a zero width range built
   on it, so both read the same. */
function positionPastePopup() {
  const popup = document.getElementById("pastePopup");
  if (!popup || !pastePopupSession) { return; }
  const end = pastePopupSession.end;
  if (!end || !end.node || !pasteBodyEl().contains(end.node)) { return; }
  const range = document.createRange();
  try {
    range.setStart(end.node, Math.min(end.offset,
      end.node.nodeType === 3
        ? end.node.nodeValue.length : end.node.childNodes.length));
    range.collapse(true);
  } catch (err) { return; }
  let rect = null;
  try { rect = range.getBoundingClientRect(); } catch (err) {
    rect = null;
  }
  if (!rect) {
    /* A host without Range geometry (a headless DOM): park
       the card at the editor's own top corner instead of
       leaving it wherever the stylesheet put it. */
    const bodyRect = pasteBodyEl().getBoundingClientRect();
    rect = { left: bodyRect.left, top: bodyRect.top,
      bottom: bodyRect.top };
  }
  const popupW = popup.offsetWidth || 300;
  const popupH = popup.offsetHeight || 190;
  let left = Math.max(8, Math.min(rect.left,
    window.innerWidth - popupW - 8));
  let top = rect.bottom + 6;
  if (top + popupH > window.innerHeight - 8 && rect.top - popupH - 6 > 8) {
    top = rect.top - popupH - 6;
  }
  popup.style.left = left + "px";
  popup.style.top = top + "px";
}

/* Show the popup for a fresh session: rows synced to the mode
   the paste landed in, then positioned. Focus never moves;
   the editor keeps the keyboard. */
function showPastePopup() {
  const popup = document.getElementById("pastePopup");
  if (!popup || !pastePopupSession) { return; }
  popup.classList.remove("hidden");
  syncPastePopupRows();
  positionPastePopup();
}

/* A bookmark for one end of the current selection, as live
   node plus offset. Returns null when there is no usable
   selection inside the editor. */
function pasteSelectionBookmark(fromEnd) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { return null; }
  const node = fromEnd ? sel.focusNode : sel.anchorNode;
  const offset = fromEnd ? sel.focusOffset : sel.anchorOffset;
  if (!node || !pasteBodyEl().contains(node)) { return null; }
  return { node: node, offset: offset };
}

/* Rebuild the range the paste occupies from its bookmarks,
   for the fallback switch path. Null when either bookmark's
   node has left the document (the popup is dismissed before
   that can happen in practice; this is the seatbelt). */
function pasteRangeFromBookmarks(session) {
  if (!session || !session.start || !session.end) { return null; }
  if (!pasteBodyEl().contains(session.start.node) ||
      !pasteBodyEl().contains(session.end.node)) { return null; }
  const range = document.createRange();
  try {
    range.setStart(session.start.node, session.start.offset);
    range.setEnd(session.end.node, session.end.offset);
  } catch (err) { return null; }
  return range;
}

/* Swap the paste's rendering for another mode's, in place.
   See the block comment above for the undo composition. The
   applying flag keeps the input listener from reading the
   programmatic insert as the user's next edit (which would
   dismiss the popup mid-switch). */
function applyPasteMode(mode) {
  const session = pastePopupSession;
  if (!session) { return; }
  if (mode === session.mode) { syncPastePopupRows(); return; }
  const rendered = renderPasteForMode(mode, session.html, session.text);
  pastePopupApplying = true;
  try {
    pasteBodyEl().focus();
    let undone = false;
    try {
      undone = document.execCommand("undo", false, null);
    } catch (err) { undone = false; }
    if (undone) {
      /* The paste's insert is off the document; the caret is
         back where the paste landed. Insert the new rendering
         there, through the paste's own call. */
      document.execCommand("insertHTML", false, rendered);
    } else {
      const range = pasteRangeFromBookmarks(session);
      if (!range) { closePastePopup(); return; }
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      captureCaret();
      document.execCommand("insertHTML", false, rendered);
    }
    /* The insert leaves the caret at the end of the new
       rendering: that is the session's new end bookmark. */
    const endBm = pasteSelectionBookmark(true);
    if (endBm) { session.end = endBm; }
    session.mode = mode;
    markDirty();
    /* v2.116: a mode switch re-lands the paste, so it
       owes the landed content the same decoration the
       paste itself now gets (see the paste handler):
       the passes are idempotent and preserve the
       bookmark nodes, so the session's end stands. */
    decorateLinkTooltips(pasteBodyEl());
    decorateLinkViews(pasteBodyEl());
    decorateTaskLinks(pasteBodyEl());
    /* v2.117: the re-landed rendering's done
       items take their own content wrap in the
       same pass (see the paste handler's note in
       the app wiring). */
    decorateDoneItems(pasteBodyEl());
    syncPastePopupRows();
    positionPastePopup();
  } finally {
    pastePopupApplying = false;
  }
}

/* v2.6.0: remove background styling from exactly the part of the
   body the range covers. For every text node the range touches,
   each background carrying span above it is split around the node
   (so the strip touches only the selected part) and then loses its
   background properties; a span left with no attributes at all was
   pure background and is unwrapped, restoring plain text, while a
   span still carrying other styling (color, font) or a class stays
   in place minus the background. Only spans are touched: table cell
   backgrounds live on cells, not spans, and are the cell menu's
   business, not the text highlight's. */
function stripBackgroundFromRange(range) {
  const bodyEl = document.getElementById("noteBody");
  const walker = document.createTreeWalker(
    bodyEl, NodeFilter.SHOW_TEXT, null);
  const targets = [];
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    const inAttachment = parent && parent.closest(".ss-attachment");
    if (!inAttachment && node.nodeValue.length &&
        range.intersectsNode(node)) {
      targets.push(node);
    }
    node = walker.nextNode();
  }
  targets.forEach(function (textNode) {
    const chain = [];
    let el = textNode.parentElement;
    while (el && el !== bodyEl) {
      if (el.tagName === "SPAN" && spanHasBackground(el)) {
        chain.unshift(el);
      }
      el = el.parentElement;
    }
    chain.forEach(function (span) {
      if (!span.parentNode) { return; }
      const piece = splitSpanAround(span, textNode);
      piece.style.removeProperty("background-color");
      piece.style.removeProperty("background");
      if (piece.getAttribute("style") === "") {
        piece.removeAttribute("style");
      }
      if (piece.attributes.length === 0) {
        const parent = piece.parentNode;
        while (piece.firstChild) {
          parent.insertBefore(piece.firstChild, piece);
        }
        parent.removeChild(piece);
      }
    });
  });
}

/* v2.6.0: the highlight palette's None choice (the first swatch in
   the grid, and the No highlight button, which now runs this too).
   Step one is the palette's own mechanism, the same applyHighlight
   path every color uses, with transparent. Step two (in
   stripBackgroundFromRange) removes what step one can leave
   behind: engines may keep a background-color: transparent inline
   style on the cleared range (and the span fallback always does),
   and an older span the command did not split keeps its color over
   part of the range. After both steps the saved body holds no
   background styling for the cleared range, while other formatting
   on the same text (color, bold, font) is untouched. */
function clearHighlightSelection() {
  applyHighlight("transparent");
  const bodyEl = document.getElementById("noteBody");
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { return; }
  const range = sel.getRangeAt(0);
  if (range.collapsed ||
      !bodyEl.contains(range.commonAncestorContainer)) { return; }
  stripBackgroundFromRange(range);
  markDirty();
}

/* ----- v2.25: the clear formatting deep clean -------------------
   The elements whose tag is pure presentation. SPAN and FONT
   are unwrapped unconditionally: the span unwrap is the
   extended clear's oldest behavior (the toolbar's own font,
   size, color, and highlight helpers all write spans), and
   FONT is its pasted content twin, carrying face, size, and
   color attributes and no structure. CENTER likewise. Any
   OTHER inline element is unwrapped only when this pass's own
   strip left it attributeless: it carried a style or a
   presentational attribute into the pass and holds nothing
   now, so what remains is a styled wrapper with the styling
   gone. An inline element that arrived attributeless (a plain
   <b> the user typed, say) is removeFormat's business inside
   the selection, not this pass's. */
const CLEAR_DEEP_UNWRAP_ALWAYS = { SPAN: 1, FONT: 1, CENTER: 1 };
const CLEAR_DEEP_UNWRAP_IF_STRIPPED = { B: 1, I: 1, U: 1, EM: 1,
  STRONG: 1, S: 1, STRIKE: 1, SUB: 1, SUP: 1, SMALL: 1, BIG: 1,
  TT: 1, MARK: 1 };
const CLEAR_PRESENTATIONAL_ATTRS = ["face", "size", "color",
  "bgcolor", "align", "valign"];

/* Clean ONE element, in place. Returns true when the element
   was unwrapped (its children moved up into its parent and
   the element itself removed). The guards, in order:
     - anything inside an attachment block, or the block
       itself, is skipped whole: an image figure's own style
       is its saved width, its faces are runtime furniture,
       and none of it is text formatting;
     - INPUT elements are skipped entirely: a checklist
       checkbox is function, not formatting;
     - a span carrying the ss-tab class, or one of the link
       view runtime classes (ss-link-face, ss-link-original),
       keeps its element and its class: the tab character it
       holds renders through that class, and the link spans
       are faces the save funnel strips on its own. Their
       style and presentational attributes still come off,
       like everything else's.
   What comes off: the whole style attribute, and the
   presentational attributes in CLEAR_PRESENTATIONAL_ATTRS.
   What never comes off: href, src, colspan, rowspan, every
   data-* attribute (the note link and image state lives
   there), and every class (app owned classes carry behavior,
   and foreign pasted classes are inert in this app). */
function clearDeepCleanElement(el) {
  if (!el || el.nodeType !== 1) { return false; }
  if (el.closest && el.closest(".ss-attachment")) { return false; }
  /* v2.37.0: a table of contents block is generated content,
     not formatting: the deep clean never unwraps, strips, or
     descends into it, exactly as with an attachment block. */
  if (el.closest && el.closest(".ss-toc")) { return false; }
  /* v2.49.0: a note tasks block is generated content on
     the same rule: the deep clean never unwraps, strips,
     or descends into it or anything inside it. */
  if (el.closest && el.closest(".ss-note-tasks")) { return false; }
  /* v2.48.0: a fold toggle is editor chrome in the same
     sense: the deep clean never unwraps, strips, or
     descends into it (its chevron span would otherwise
     meet the span unwrap rule and the arrow would lose
     its triangle while the fold itself survived). */
  if (el.closest && el.closest(".ss-fold-toggle")) { return false; }
  if (el.tagName === "INPUT") { return false; }
  let stripped = false;
  if (el.hasAttribute("style")) {
    el.removeAttribute("style");
    stripped = true;
  }
  CLEAR_PRESENTATIONAL_ATTRS.forEach(function (attr) {
    if (el.hasAttribute(attr)) {
      el.removeAttribute(attr);
      stripped = true;
    }
  });
  const keepSpan = el.tagName === "SPAN" && el.classList &&
    (el.classList.contains("ss-tab") ||
      el.classList.contains("ss-link-face") ||
      el.classList.contains("ss-link-original"));
  if (keepSpan) { return false; }
  const unwrap = CLEAR_DEEP_UNWRAP_ALWAYS[el.tagName] ||
    (stripped && el.attributes.length === 0 &&
      CLEAR_DEEP_UNWRAP_IF_STRIPPED[el.tagName]);
  if (!unwrap || !el.parentNode) { return false; }
  const parent = el.parentNode;
  while (el.firstChild) { parent.insertBefore(el.firstChild, el); }
  parent.removeChild(el);
  return true;
}

/* The deep clean over a set of roots, plus every element a
   range intersects. Each root contributes itself and all its
   descendants. The range reach exists for content whose top
   level block the conversion plan deliberately skips, above
   all a table: the selection inside its cells intersects
   the cell content directly, and the table itself contributes
   its descendants as a touched root, so cell text clears
   while the table, its rows, and its cells (and their
   colspan and rowspan) stand. Elements are collected first
   and cleaned in reverse document order, so unwrapping a
   parent never disturbs the cleaning of the children it
   held; they are cleaned first, while they still sit in it. */
function clearDeepCleanRoots(roots, range) {
  const bodyEl = document.getElementById("noteBody");
  const seen = new Set();
  const els = [];
  function add(el) {
    if (el && !seen.has(el)) { seen.add(el); els.push(el); }
  }
  (roots || []).forEach(function (root) {
    if (!root || root.nodeType !== 1) { return; }
    add(root);
    root.querySelectorAll("*").forEach(add);
  });
  if (range && bodyEl) {
    bodyEl.querySelectorAll("*").forEach(function (el) {
      let hit = false;
      try { hit = range.intersectsNode(el); } catch (e) { hit = false; }
      if (hit) { add(el); }
    });
  }
  for (let i = els.length - 1; i >= 0; i--) {
    clearDeepCleanElement(els[i]);
  }
}

/* ----- v2.25.1: the malformed block lift and the conversion
   guarantee ---------------------------------------------------
   Chris's SnakeScale CAD note held a heading with block
   elements nested inside it (an empty paragraph and a div
   holding the text), a shape pasted content can produce and
   the parser keeps as authored. Remove formatting could not
   clear that line: the heading carried no style attribute
   for the v2.25 deep clean to strip, because its formatting
   IS the element, and the browser's formatBlock, asked to
   convert a block whose contents include other blocks,
   converts the inner pieces and leaves the heading wrapper
   standing (the note he saved after his attempts still held
   the heading untouched). Two deterministic passes inside
   the clear operation close the hole. The lift, below, runs
   before the conversion plan is computed and promotes block
   children out of a touched host, so the plan and every
   later pass see ordinary top level blocks. The replacement
   pass (clearReplaceUnconvertedBlocks) runs after the
   browser conversions and swaps any planned block the
   browser still left standing with its old formatting tag
   for a fresh element of the target tag. */

/* The host tags the lift examines: top level blocks whose
   own tag carries text formatting or text flow. Lists are
   not hosts (their items are the conversion plan's
   business), tables are not hosts (their cells are not text
   flow), attachment blocks are not hosts (the wrapper is
   the attachment's card), and figures are not hosts (their
   children are media and a caption, not flow blocks). */
const CLEAR_LIFT_HOSTS = { H1: 1, H2: 1, H3: 1, H4: 1, H5: 1,
  H6: 1, P: 1, DIV: 1, BLOCKQUOTE: 1, PRE: 1, ADDRESS: 1,
  SECTION: 1, ARTICLE: 1 };

/* The block level tags that count as nested block children
   inside a host, and that the lift promotes to the top
   level. */
const CLEAR_LIFT_CHILDREN = { P: 1, DIV: 1, H1: 1, H2: 1,
  H3: 1, H4: 1, H5: 1, H6: 1, UL: 1, OL: 1, BLOCKQUOTE: 1,
  PRE: 1, TABLE: 1, FIGURE: 1, HR: 1 };

/* Lift the block children of ONE host out to the top level,
   in place. Returns the array of top level blocks the host
   became (in document order), or null when the host is not
   a lift case and stands untouched. The guards:
     - the host must be a lift host tag with at least one
       block level element child; anything else is ordinary
       text flow and none of this pass's business;
     - a host that is an attachment block, or holds one
       anywhere inside it, is skipped whole: attachments are
       never moved by the clear operation.
   The walk goes in document order. A block child is
   promoted as it stands; an empty one (the strict
   clearBlockIsEmpty sense) is dropped instead, except a
   rule, which is content even though it holds nothing. Any
   bare text or inline run between block children is wrapped
   in a fresh block of the host's own tag, so the conversion
   plan judges that run by the flow it lands in, exactly
   like any other line; whitespace only runs between blocks
   are dropped. A promoted child that is itself a host
   holding block children is lifted in turn, so nesting
   flattens completely in one call. The host shell, emptied
   by construction, is removed. */
function clearLiftNestedBlocks(bodyEl, host) {
  if (!host || host.nodeType !== 1 || !host.parentNode) {
    return null;
  }
  if (!CLEAR_LIFT_HOSTS[host.tagName]) { return null; }
  if (host.classList && host.classList.contains("ss-attachment")) {
    return null;
  }
  if (host.querySelector && host.querySelector(".ss-attachment")) {
    return null;
  }
  /* v2.37.0: a host that IS a table of contents block, or
     one holding one, is never lifted either: lifting would
     promote the block's entry list out of the generated
     block and destroy it. */
  if (host.classList && host.classList.contains("ss-toc")) {
    return null;
  }
  if (host.querySelector && host.querySelector(".ss-toc")) {
    return null;
  }
  /* v2.49.0: a host that IS a note tasks block, or one
     holding one, is never lifted either, on the same
     rule: lifting would promote the block's painted rows
     out of the generated block and destroy it. */
  if (host.classList && host.classList.contains("ss-note-tasks")) {
    return null;
  }
  if (host.querySelector && host.querySelector(".ss-note-tasks")) {
    return null;
  }
  let hasBlockChild = false;
  Array.prototype.forEach.call(host.children, function (kid) {
    if (CLEAR_LIFT_CHILDREN[kid.tagName]) { hasBlockChild = true; }
  });
  if (!hasBlockChild) { return null; }
  const pieces = [];
  let run = [];
  function flushRun() {
    const meaningful = run.some(function (node) {
      return node.nodeType === 1 ||
        (node.nodeValue &&
          node.nodeValue.replace(/\s+/g, "") !== "");
    });
    if (run.length && meaningful) {
      const wrap = document.createElement(host.tagName);
      run.forEach(function (node) { wrap.appendChild(node); });
      pieces.push(wrap);
    }
    /* A run that is not meaningful is plain inter block
       whitespace: it is simply left in the shell, which is
       removed below. */
    run = [];
  }
  Array.prototype.slice.call(host.childNodes).forEach(
    function (node) {
      if (node.nodeType === 1 && CLEAR_LIFT_CHILDREN[node.tagName]) {
        flushRun();
        if (node.tagName !== "HR" && clearBlockIsEmpty(node)) {
          node.remove();
          return;
        }
        pieces.push(node);
      } else {
        run.push(node);
      }
    });
  flushRun();
  pieces.forEach(function (piece) {
    host.parentNode.insertBefore(piece, host);
  });
  host.remove();
  const out = [];
  pieces.forEach(function (piece) {
    const sub = clearLiftNestedBlocks(bodyEl, piece);
    if (sub) {
      sub.forEach(function (s) { out.push(s); });
    } else {
      out.push(piece);
    }
  });
  return out;
}

/* Run the lift over the touched set and return the set the
   rest of the operation works with: each host the lift
   rewrote is replaced by the blocks it became, in place,
   and every other block passes through as it was. */
function clearLiftTouchedBlocks(bodyEl, touched) {
  const out = [];
  (touched || []).forEach(function (block) {
    const pieces = clearLiftNestedBlocks(bodyEl, block);
    if (pieces) {
      pieces.forEach(function (p) { out.push(p); });
    } else {
      out.push(block);
    }
  });
  return out;
}

/* The formatting block tags the replacement pass guarantees
   against: the tags whose element alone is formatting the
   clear exists to remove. */
const CLEAR_REPLACE_TAGS = { H1: 1, H2: 1, H3: 1, H4: 1,
  H5: 1, H6: 1, BLOCKQUOTE: 1, PRE: 1 };

/* The deterministic conversion guarantee. Walk the
   conversion plan after the browser commands and the second
   cleaning passes: any planned block that is still
   connected, still a direct child of the body, and still
   wearing a formatting tag different from its planned
   target is replaced in the DOM with a fresh element of the
   target tag, its children moved over as they stand. The
   fresh element carries no attributes by construction, so
   no further cleaning is owed for it. A block the browser
   converted is detached (the engine rebuilt it) or already
   carries the target tag, and is skipped untouched, so this
   pass is a strict no-op wherever the browser did its work.
   List entries and the bare entry hold no single block to
   replace and are out of scope. */
function clearReplaceUnconvertedBlocks(plan) {
  const bodyEl = document.getElementById("noteBody");
  (plan || []).forEach(function (entry) {
    if (!entry || entry.bare || entry.items || !entry.block) {
      return;
    }
    const block = entry.block;
    if (!block.isConnected || !block.parentNode) { return; }
    if (block.parentNode !== bodyEl) { return; }
    if (!CLEAR_REPLACE_TAGS[block.tagName]) { return; }
    if (block.tagName === entry.target) { return; }
    const repl = document.createElement(entry.target);
    while (block.firstChild) { repl.appendChild(block.firstChild); }
    block.parentNode.replaceChild(repl, block);
  });
}

/* v2.40.0: unwrap the code elements inside every pre the
   clear touches. A code block's code child is part of the
   code formatting being removed: left in place it would
   ride the block conversion into the new paragraph and
   keep the text monospace (a browser's own style for the
   element), so the clear would leave standing the one
   style it exists to remove. Scoped to pres: inline code
   elsewhere in a selection is not this pass's business.
   The collection mirrors the deep clean's (the touched
   blocks, their descendants, and everything the range
   intersects), and the deepest code elements unwrap
   first, so a code nested in a code (a shape pasted
   markup can take) unwraps completely in one pass. */
function clearUnwrapCodeInPres(bodyEl, range, touched) {
  const pres = [];
  const seen = new Set();
  function addPre(el) {
    if (el && !seen.has(el)) { seen.add(el); pres.push(el); }
  }
  (touched || []).forEach(function (block) {
    if (!block || block.nodeType !== 1) { return; }
    if (block.tagName === "PRE") { addPre(block); }
    if (block.querySelectorAll) {
      block.querySelectorAll("pre").forEach(addPre);
    }
  });
  if (range && bodyEl) {
    bodyEl.querySelectorAll("pre").forEach(function (pre) {
      let hit = false;
      try { hit = range.intersectsNode(pre); } catch (e) {
        hit = false;
      }
      if (hit) { addPre(pre); }
    });
  }
  pres.forEach(function (pre) {
    const codes = Array.prototype.slice.call(
      pre.querySelectorAll("code"));
    codes.sort(function (a, b) {
      let da = 0, db = 0, n = a, m = b;
      while (n && n !== pre) { da++; n = n.parentElement; }
      while (m && m !== pre) { db++; m = m.parentElement; }
      return db - da;
    });
    codes.forEach(function (code) {
      if (!code.parentNode) { return; }
      const parent = code.parentNode;
      while (code.firstChild) {
        parent.insertBefore(code.firstChild, code);
      }
      parent.removeChild(code);
    });
  });
}

/* ----- remove formatting (extended) ---------------------------------------
   Starts with the classic behavior (removeFormat plus formatBlock),
   then unwraps the spans our own font, size, color, and highlight
   helpers created inside the selection: removeFormat alone leaves
   those spans in place in most engines, which would make the toolbar's
   own formatting impossible to fully clear.

   v2.14: the formatBlock target is no longer always P. The stylesheet
   gives paragraphs no rule of their own, so a converted paragraph
   carries the browser's default block margin (1em) and a line that
   used to be marginless (a list item, a typed div line) gains about
   15px of space under it: the extra gap Chris saw after clearing.
   The fix has two parts. A classifier classifies the touched
   blocks' flow BEFORE the commands run and picks DIV for
   marginless flow, so the converted lines keep the spacing they
   had; paragraph flow keeps P, today's proven behavior there. And
   clearFormattingNormalize removes any block the operation left
   empty, so no hollow shell is left holding space either.

   v2.14.3: the classification is per block now, not one target
   for the whole operation. The single target converted every
   block a mixed selection touched at one flow's margins: a div
   line selected alongside a paragraph became a paragraph and
   gained the space, a paragraph selected alongside a list item
   became a div and lost its own, a heading was judged by
   neighbours that included blocks outside the selection, a
   blockquote had no branch at all and fell through to P, and a
   caret in a bare text line (text with no block element around
   it) touched no block at all, starved the classifier, and
   took its hard coded P. clearConversionPlan now plans one
   conversion per touched block, each with the target that
   block's own flow dictates, and the bare line is judged from
   the flow around the caret.

   v2.25: the operation also runs the deep clean above
   (clearDeepCleanRoots) over the touched blocks and every
   element the selection intersects, once before removeFormat
   and once after the conversions. Through v2.24.9 the clear
   reached spans and backgrounds only, so an inline style
   riding on a pasted block itself, or on a link, a font
   element, or content inside a table cell, survived whole:
   the text Chris reported as impossible to unformat. The
   second run matters for the same reason the second
   background pass exists: an engine's formatBlock may rebuild
   a block and carry its attributes onto the replacement, so
   the final state is cleaned after the conversions settle.

   v2.25.1: two deterministic passes join the operation (see
   the lift and guarantee section above). The lift promotes
   blocks nested inside a touched block out to the top level
   before the plan is computed, and after the conversions
   the replacement pass swaps any planned block the browser
   left wearing its old heading, quote, or pre tag for a
   fresh element of the target tag. Both exist for the field
   case behind this release: a heading with blocks nested
   inside it, whose formatting is the element itself (no
   style attribute for the deep clean to strip) and which
   the browser's block conversion leaves standing. */
/* v2.109.0: the plain link pass of one clear formatting
   run. Everything else the operation removes is
   presentation, and a link was the one survivor: href
   was never treated as formatting, so a cleared link
   stood afterward still styled and still live (Chris's
   report: "Clear formatting doesn't fully work"). The
   pass follows Word's Clear All Formatting: the link's
   text stays and the link itself goes. Two kinds of
   anchor are NOT plain links and never lose their
   target here:
     - anchors the app manages (note links, mail and
       event chips, tag pills: anything carrying an
       ss- class) are content objects, not formatting,
       and stand exactly as attachments, TOC blocks,
       and task blocks stand under this operation;
     - anchors inside those protected blocks, and
       inside encrypted passages, are untouched.
   A decorated link (one wearing a view face) unwraps
   to its original content: the hidden .ss-link-original
   span holds the words the author wrote, and the
   generated .ss-link-face goes with the anchor, so no
   doubled or hidden text is left behind. The pass runs
   over the same reach as the deep cleans (the touched
   blocks plus everything the post-command range
   intersects), so a link a conversion carried onto a
   rebuilt block is caught as well. */
function clearUnwrapPlainLinks(bodyEl, roots, range) {
  const seen = new Set();
  const anchors = [];
  function consider(a) {
    if (!a || seen.has(a)) { return; }
    seen.add(a);
    if (a.closest && (a.closest(".ss-attachment") ||
        a.closest(".ss-toc") ||
        a.closest(".ss-note-tasks") ||
        a.closest("[data-ssenc]") ||
        a.closest(".ssenc-open"))) {
      return;
    }
    const tokens = (a.getAttribute("class") || "")
      .split(/\s+/);
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].indexOf("ss-") === 0) { return; }
    }
    anchors.push(a);
  }
  (roots || []).forEach(function (root) {
    if (!root || root.nodeType !== 1 ||
        !root.isConnected) { return; }
    if (root.tagName === "A") { consider(root); }
    root.querySelectorAll("a").forEach(consider);
  });
  if (range && bodyEl) {
    bodyEl.querySelectorAll("a").forEach(function (a) {
      let hit = false;
      try { hit = range.intersectsNode(a); }
      catch (e) { hit = false; }
      if (hit) { consider(a); }
    });
  }
  for (let i = anchors.length - 1; i >= 0; i--) {
    const a = anchors[i];
    const parent = a.parentNode;
    if (!parent) { continue; }
    /* A decorated anchor is first restored to the
       children it was saved with (the app's own
       stripLinkFaces: faces off, originals unwrapped),
       so what lands in the text is exactly the words
       the author wrote, never the face's rendering
       of them. */
    stripLinkFaces(a);
    while (a.firstChild) {
      parent.insertBefore(a.firstChild, a);
    }
    parent.removeChild(a);
  }
}

function clearFormattingExtended() {
  const bodyEl = document.getElementById("noteBody");
  restoreFormatSelection();
  const sel0 = window.getSelection();
  const range0 = (sel0 && sel0.rangeCount) ? sel0.getRangeAt(0) : null;
  /* v2.25.1: the lift runs first, before the plan, so a
     malformed block (a heading or wrapper holding other
     blocks) reaches the plan as the ordinary top level
     blocks it becomes. touchedBefore from here on is the
     post lift set every later pass works with. */
  const touchedBefore = clearLiftTouchedBlocks(bodyEl,
    clearTouchedTopBlocks(bodyEl, range0));
  /* v2.40.0: a touched code block's code wrapper is code
     formatting too, and goes before the plan is computed
     (see clearUnwrapCodeInPres). */
  clearUnwrapCodeInPres(bodyEl, range0, touchedBefore);
  const plan = clearConversionPlan(bodyEl, range0, touchedBefore);
  /* v2.18: the operation also strips background styling (the
     cleanBackgroundsInRoots pass) from every touched top
     level block and all its descendants: the cure half of
     the paste background fix. A background that arrived on a
     pasted paragraph lives on the block itself, where
     removeFormat does not reach (Chris's report: the white
     box behind email text could not be reset even with
     Remove Formatting). The pass runs here, on the blocks as
     captured, and again after the conversions, because an
     engine's formatBlock may rebuild a block and carry its
     attributes onto the replacement. */
  cleanBackgroundsInRoots(touchedBefore);
  /* v2.25: the first deep clean, over the touched blocks as
     captured and everything the pre-command range reaches. */
  clearDeepCleanRoots(touchedBefore, range0);
  document.execCommand("removeFormat", false, null);
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const range = sel.getRangeAt(0);
    if (!range.collapsed && bodyEl.contains(range.commonAncestorContainer)) {
      const spans = [];
      bodyEl.querySelectorAll("span").forEach(function (s) {
        spans.push(s);
      });
      spans.forEach(function (s) {
        if (s.closest(".ss-attachment")) { return; }
        /* v2.109.0: the link decoration spans and the
           tab span keep the deep clean's protection
           here too. Unwrapping a decorated link's
           .ss-link-original and .ss-link-face into
           their anchor would leave the face's words
           standing beside the original words (doubled
           text) before the link pass below can restore
           the anchor's own children; the pass now
           undecorates first (stripLinkFaces), so these
           spans are its business, not this sweep's. */
        if (s.classList && (s.classList.contains("ss-tab") ||
            s.classList.contains("ss-link-face") ||
            s.classList.contains("ss-link-original"))) {
          return;
        }
        if (range.intersectsNode(s)) {
          const parent = s.parentNode;
          while (s.firstChild) { parent.insertBefore(s.firstChild, s); }
          parent.removeChild(s);
        }
      });
    }
  }
  plan.forEach(function (entry) { clearApplyConversion(entry); });
  /* v2.18: the second background pass, over the touched blocks
     that survived and whatever blocks the conversions left
     the selection in (a rebuilt block can carry the old
     block's background with it; see the header note). */
  const selAfter = window.getSelection();
  const rangeAfter = (selAfter && selAfter.rangeCount)
    ? selAfter.getRangeAt(0) : null;
  cleanBackgroundsInRoots(touchedBefore.concat(
    clearTouchedTopBlocks(bodyEl, rangeAfter)));
  /* v2.25: the second deep clean, over the touched blocks
     that survived, whatever blocks the conversions left the
     selection in, and everything the post-command range
     reaches, so no attribute a conversion carried onto a
     rebuilt block survives either. */
  clearDeepCleanRoots(touchedBefore.concat(
    clearTouchedTopBlocks(bodyEl, rangeAfter)), rangeAfter);
  /* v2.25.1: the conversion guarantee, after the cleaning
     passes and before normalization (a replacement element
     is fresh and attributeless by construction, so it owes
     no cleaning; normalization still gets to remove any
     shell the replacement leaves empty). */
  clearReplaceUnconvertedBlocks(plan);
  /* v2.109.0: the plain link pass, last among the
     cleaning passes and over the same reach the second
     deep clean used, so no link survives the operation
     on a touched block (see clearUnwrapPlainLinks). */
  clearUnwrapPlainLinks(bodyEl, touchedBefore.concat(
    clearTouchedTopBlocks(bodyEl, rangeAfter)), rangeAfter);
  clearFormattingNormalize(bodyEl, touchedBefore);
}

/* The top level blocks of the body that a range touches, in document
   order. Shared by the clear formatting classifier and its
   normalization pass. A collapsed range touches the block its caret
   sits in. */
function clearTouchedTopBlocks(bodyEl, range) {
  const out = [];
  if (!range) { return out; }
  Array.prototype.forEach.call(bodyEl.children, function (child) {
    let hit = false;
    try { hit = range.intersectsNode(child); } catch (e) { hit = false; }
    if (!hit && range.collapsed) {
      hit = child.contains(range.startContainer);
    }
    if (hit) { out.push(child); }
  });
  return out;
}

/* v2.14.3: the conversion plan for one clear formatting run.
   One entry per touched top level block, each carrying the
   target that block's own flow dictates (clearFormatTargetFor-
   Block). A list plans per touched ITEM (clearTouchedListItems),
   so the conversion applies to the items the range actually
   touches and a caret in one item never dissolves the whole
   list. Blocks that are not text flow get no entry at all: a
   table, an attachment placeholder or figure, and a rule have
   no block tag conversion to take, and an attachment's own
   wrapper div is its card, not a typed line. A touched set
   that is empty (a caret or a selection in a bare text line,
   which has no block element to classify) plans a single bare
   entry: the conversion runs on the live range with a target
   judged from the flow around the caret (clearSurroundingFlow-
   Target), never a blind default. The plan is computed from
   the pre-command range and holds node references, not
   positions, because the conversions themselves move nodes
   (a list extraction splits its list around the new block);
   entries still to come are found again by identity. */
function clearConversionPlan(bodyEl, range, touched) {
  const plan = [];
  if (!range) { return plan; }
  (touched || []).forEach(function (block) {
    if (!block.isConnected || block.parentNode !== bodyEl) { return; }
    if (block.classList && block.classList.contains("ss-attachment")) {
      return;
    }
    /* v2.37.0: a table of contents block is never planned
       for conversion either: it is not a paragraph wearing
       formatting, it is generated content. */
    if (block.classList && block.classList.contains("ss-toc")) {
      return;
    }
    /* v2.49.0: a note tasks block is never planned for
       conversion either: generated content, not a
       paragraph wearing formatting. */
    if (block.classList && block.classList.contains("ss-note-tasks")) {
      return;
    }
    const tag = block.tagName;
    if (tag === "TABLE" || tag === "FIGURE" || tag === "HR") { return; }
    if (tag === "UL" || tag === "OL") {
      const items = clearTouchedListItems(block, range);
      if (items.length) {
        plan.push({ list: block, items: items, target: "DIV" });
      }
      return;
    }
    plan.push({ block: block,
      target: clearFormatTargetForBlock(bodyEl, block) });
  });
  if (!plan.length && !(touched || []).length) {
    plan.push({ bare: true,
      target: clearSurroundingFlowTarget(bodyEl, range) });
  }
  return plan;
}

/* The list items a range touches inside one list, nested items
   included: the same test the v2.14 single target classifier
   used to decide a whole operation on any one touched item. */
function clearTouchedListItems(listEl, range) {
  const items = [];
  if (!range) { return items; }
  Array.prototype.forEach.call(listEl.querySelectorAll("li"),
    function (li) {
      let hit = false;
      try { hit = range.intersectsNode(li); } catch (e) { hit = false; }
      if (!hit && range.collapsed) {
        hit = li.contains(range.startContainer);
      }
      if (hit) { items.push(li); }
    });
  return items;
}

/* v2.14.3: the formatBlock target for ONE touched block, from
   its own flow class. The fixed classes keep the cases the
   earlier classifiers already proved: a list and a div line
   take DIV (marginless in, marginless out), a paragraph stays
   P. Everything else (a heading, a blockquote, a pre, any
   other block) is judged by the flow immediately around it,
   that block alone: clearFlowTargetAround. */
function clearFormatTargetForBlock(bodyEl, block) {
  const tag = block.tagName;
  if (tag === "UL" || tag === "OL") { return "DIV"; }
  if (tag === "DIV") { return "DIV"; }
  if (tag === "P") { return "P"; }
  return clearFlowTargetAround(block);
}

/* The flow target for a block judged by its own neighbours:
   P only in real paragraph flow, meaning every neighbour
   that exists is a paragraph. Anything else takes DIV, the
   safe side: a div has no block margins of its own, so a
   conversion to it can only hold or shrink the gaps beside
   the block, never grow them, whatever the neighbours are.
   The v2.14 heading branch let any one paragraph neighbour
   settle P for the block; beside a marginless neighbour on
   the other side that was exactly a proven gain (a heading
   between a paragraph and a div line gained 10.5px under
   itself), so one paragraph neighbour no longer suffices:
   the flow must be paragraphs on both sides, which is also
   the case the classic conversion was proven unchanged in
   (a heading between paragraphs converts to P and no gap
   moves). A block with no neighbours at all keeps the
   classic P: there are no gaps for it to grow. */
function clearFlowTargetAround(el) {
  const sibs = [];
  if (el.previousElementSibling) {
    sibs.push(el.previousElementSibling);
  }
  if (el.nextElementSibling) { sibs.push(el.nextElementSibling); }
  if (!sibs.length) { return "P"; }
  for (let i = 0; i < sibs.length; i++) {
    if (sibs[i].tagName !== "P") { return "DIV"; }
  }
  return "P";
}

/* The target when the touched set is empty: the caret (or
   the selection) sits in a bare text line, text that is a
   direct child of the body with no block element around it,
   so there is no block to classify and the v2.14 classifier
   starved into its hard coded P, wrapping the line in a
   paragraph with margins on both sides. Judge from the flow
   at the caret instead: the element siblings on either side
   of the body child the caret sits in. Paragraph flow (at
   least one element sibling, and every one a paragraph)
   keeps P, where the wrap provably grows no gap; div lines
   or lists around it take DIV; with nothing around it at
   all, DIV as well, the marginless reading of a typed line. */
function clearSurroundingFlowTarget(bodyEl, range) {
  if (!range) { return "DIV"; }
  let before = null;
  let after = null;
  if (range.startContainer === bodyEl) {
    const kids = bodyEl.childNodes;
    for (let i = range.startOffset - 1; i >= 0; i--) {
      if (kids[i].nodeType === 1) { before = kids[i]; break; }
    }
    for (let i = range.startOffset; i < kids.length; i++) {
      if (kids[i].nodeType === 1) { after = kids[i]; break; }
    }
  } else {
    let child = range.startContainer;
    while (child && child.parentNode && child.parentNode !== bodyEl) {
      child = child.parentNode;
    }
    if (!child || child.parentNode !== bodyEl) { return "DIV"; }
    before = child.previousElementSibling;
    after = child.nextElementSibling;
  }
  const sibs = [];
  if (before) { sibs.push(before); }
  if (after) { sibs.push(after); }
  if (!sibs.length) { return "DIV"; }
  for (let i = 0; i < sibs.length; i++) {
    if (sibs[i].tagName !== "P") { return "DIV"; }
  }
  return "P";
}

/* Apply one planned conversion. A real engine's formatBlock
   acts on the blocks the selection touches, so the selection
   is set to the block's (or the item's) own contents and the
   command runs with that entry's target: one block converts,
   at its own margins, whatever else the user's selection
   covered. The bare entry runs on the live selection as it
   stands: the caret in the bare line is the range the
   command needs to wrap it. A node the earlier conversions
   have since detached is skipped: its content was converted
   with the block that carried it. */
function clearApplyConversion(entry) {
  const sel = window.getSelection();
  if (!sel) { return; }
  if (entry.bare) {
    document.execCommand("formatBlock", false, entry.target);
    return;
  }
  const nodes = entry.items || [entry.block];
  nodes.forEach(function (node) {
    if (!node.isConnected) { return; }
    const r = document.createRange();
    r.selectNodeContents(node);
    sel.removeAllRanges();
    sel.addRange(r);
    document.execCommand("formatBlock", false, entry.target);
  });
}

/* v2.14: the strict emptiness test for the normalization pass.
   A block counts as empty only when it holds nothing at all: no
   non-whitespace text, no attachment or media or control anywhere
   inside it, and no element children other than a lone br (the
   classic empty block remnant). By construction this can never
   remove a block containing text, an attachment, a table, or an
   image. */
function clearBlockIsEmpty(el) {
  if (!el || el.nodeType !== 1) { return false; }
  /* The block itself may BE the attachment or embedded element
     (an attachment placeholder is a top level div in the body);
     querySelector only looks at descendants, so guard the
     element itself first. */
  if (el.matches &&
      el.matches(".ss-attachment, img, table, iframe, audio, " +
        "video, input, textarea, select")) { return false; }
  if (el.querySelector &&
      el.querySelector(".ss-attachment, img, table, iframe, audio, " +
        "video, input, textarea, select")) { return false; }
  if (el.textContent && el.textContent.replace(/\s+/g, "") !== "") {
    return false;
  }
  const kids = el.children;
  if (kids.length > 1) { return false; }
  if (kids.length === 1 && kids[0].tagName !== "BR") { return false; }
  return true;
}

/* v2.14: after formatBlock, re-walk the blocks the operation
   touched and remove the ones it left empty. The candidate set is
   the blocks captured before the commands ran, plus the blocks
   around the selection the commands left behind, widened by two
   bounded rounds of element siblings. The widening exists
   because engines differ in where the selection lands after
   formatBlock: a split can leave its shells (an emptied list
   where the last item was extracted, a br-only remnant) up to
   two blocks away from every anchor, arranged touched block,
   converted block, remnant. The rounds stop at two, so the pass
   never wanders the whole note; the strict emptiness test is the
   real guard on every candidate. Emptied list items inside a
   touched list are removed first; a list then left with no
   items at all is removed too. */
function clearFormattingNormalize(bodyEl, touchedBefore) {
  const candidates = [];
  function add(el) {
    if (el && candidates.indexOf(el) === -1) { candidates.push(el); }
  }
  (touchedBefore || []).forEach(add);
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const range = sel.getRangeAt(0);
    if (bodyEl.contains(range.commonAncestorContainer)) {
      clearTouchedTopBlocks(bodyEl, range).forEach(function (b) {
        add(b);
        add(b.previousElementSibling);
        add(b.nextElementSibling);
      });
    }
  }
  for (let round = 0; round < 2; round++) {
    candidates.slice().forEach(function (el) {
      if (!el.isConnected) { return; }
      add(el.previousElementSibling);
      add(el.nextElementSibling);
    });
  }
  candidates.forEach(function (list) {
    if (!list.isConnected) { return; }
    if (list.tagName !== "UL" && list.tagName !== "OL") { return; }
    Array.prototype.slice.call(list.children).forEach(function (li) {
      if (li.tagName === "LI" && clearBlockIsEmpty(li)) { li.remove(); }
    });
  });
  candidates.forEach(function (el) {
    if (!el.isConnected || el.parentNode !== bodyEl) { return; }
    const orphanedList =
      (el.tagName === "UL" || el.tagName === "OL") &&
      el.querySelectorAll("li").length === 0 &&
      !el.querySelector(".ss-attachment");
    if (orphanedList || clearBlockIsEmpty(el)) { el.remove(); }
  });
}

/* ----- dropdown menus ---------------------------------------------------- */
const TB_MENU_IDS = ["insertMenu", "textColorMenu", "highlightMenu", "moreMenu"];

function closeToolbarMenus() {
  TB_MENU_IDS.forEach(function (id) {
    document.getElementById(id).classList.add("hidden");
  });
}

/* Open one menu and close the rest. The clicked button already saved
   the selection (toolbar mousedown backstop), so focus can stay with
   the menu until an item is chosen. */
function toggleToolbarMenu(id) {
  const menu = document.getElementById(id);
  const willOpen = menu.classList.contains("hidden");
  closeToolbarMenus();
  if (willOpen) {
    menu.classList.remove("hidden");
    keepMenuInViewport(menu);
  }
}

/* Menus are anchored to their button, which can sit near the right
   edge once the toolbar wraps. If a freshly opened menu would spill
   past the viewport, shift it back inside with a negative margin. */
function keepMenuInViewport(menu) {
  menu.style.marginLeft = "0px";
  const rect = menu.getBoundingClientRect();
  const vw = window.innerWidth;
  if (rect.right > vw - 8) {
    menu.style.marginLeft = "-" + Math.ceil(rect.right - (vw - 8)) + "px";
  } else if (rect.left < 8) {
    menu.style.marginLeft = Math.ceil(8 - rect.left) + "px";
  }
}

/* ----- v2.24.5: the phone toolbar's overflow panel ------------------------
   At phone widths (900px and under, the app's one pane
   breakpoint) the toolbar is one line: Insert, Voice, Bold,
   Italic, Highlight, and More. Every other control lives in
   #tbPanel, a pop out under the bar that the More button
   toggles. The mechanism is breakpoint driven relocation:
   entering phone width moves the overflow controls (the real
   elements, never clones) into the panel in the order below,
   and leaving it restores each one before its recorded next
   sibling, so the desktop toolbar's DOM, order, and behavior
   are exactly what they were. Listeners ride along with the
   elements, the palettes and the Custom color session flow
   included, and because the panel sits inside #toolbar, the
   toolbar's mousedown and focusin selection backstops and
   the outside tap rule (a click outside #toolbar closes the
   menus) cover the panel's controls with no new plumbing.
   The mode is read from window.innerWidth on resize, the
   same idiom setMobileView and the drag code already use. */
let tbPhoneMode = false;
let tbHomes = null;
let tbPanelRows = null;

/* The overflow controls, in panel order. slot "panel" items
   become direct children of the panel (the two whole groups);
   slot "color" and "more" items collect into row groups the
   panel grows for them, since they have no group of their
   own to travel in. Resolved once, while the toolbar is in
   its desktop arrangement. */
function tbOverflowItems() {
  const items = [];
  const styleSel = document.getElementById("styleSelect");
  if (styleSel && styleSel.closest(".tb-group")) {
    items.push({ el: styleSel.closest(".tb-group"), slot: "panel" });
  }
  const tcBtn = document.getElementById("textColorBtn");
  if (tcBtn && tcBtn.closest(".tb-menu-wrap")) {
    items.push({ el: tcBtn.closest(".tb-menu-wrap"), slot: "color" });
  }
  const underline = document.querySelector(
    "#toolbar [data-cmd=\"underline\"]");
  if (underline) { items.push({ el: underline, slot: "color" }); }
  const strike = document.querySelector(
    "#toolbar [data-cmd=\"strike\"]");
  if (strike) { items.push({ el: strike, slot: "color" }); }
  const ul = document.querySelector("#toolbar [data-cmd=\"ul\"]");
  if (ul && ul.closest(".tb-group")) {
    items.push({ el: ul.closest(".tb-group"), slot: "panel" });
  }
  document.querySelectorAll("#moreMenu [data-more]").forEach(
    function (btn) { items.push({ el: btn, slot: "more" }); });
  return items;
}

function tbRecordHomes() {
  tbHomes = tbOverflowItems().map(function (it) {
    return {
      el: it.el, slot: it.slot,
      parent: it.el.parentNode, next: it.el.nextSibling
    };
  });
}

function tbRelocate() {
  if (!tbHomes) { tbRecordHomes(); }
  const panel = document.getElementById("tbPanel");
  if (!panel) { return; }
  if (!tbPanelRows) {
    const color = document.createElement("div");
    color.className = "tb-group";
    const more = document.createElement("div");
    more.className = "tb-group";
    tbPanelRows = { color: color, more: more };
  }
  const groups = [];
  tbHomes.forEach(function (h) {
    if (h.slot === "color") { tbPanelRows.color.appendChild(h.el); }
    else if (h.slot === "more") { tbPanelRows.more.appendChild(h.el); }
    else { groups.push(h.el); }
  });
  /* Panel order: the style group, the color and emphasis
     row, the lists group, the More actions row. */
  if (groups[0]) { panel.appendChild(groups[0]); }
  panel.appendChild(tbPanelRows.color);
  if (groups[1]) { panel.appendChild(groups[1]); }
  panel.appendChild(tbPanelRows.more);
}

function tbRestore() {
  closeTbPanel();
  if (!tbHomes) { return; }
  /* Homes were recorded in document order; restoring in
     reverse puts every recorded next sibling back in place
     before the element that precedes it is reinserted, so
     each insertBefore lands on a sibling that is already
     home (or never left). */
  for (let i = tbHomes.length - 1; i >= 0; i--) {
    const h = tbHomes[i];
    if (!h.parent) { continue; }
    if (h.next && h.next.parentNode === h.parent) {
      h.parent.insertBefore(h.el, h.next);
    } else {
      h.parent.appendChild(h.el);
    }
  }
  if (tbPanelRows) {
    tbPanelRows.color.remove();
    tbPanelRows.more.remove();
  }
}

function tbPanelIsOpen() {
  const panel = document.getElementById("tbPanel");
  return !!panel && !panel.classList.contains("hidden");
}

function openTbPanel() {
  closeToolbarMenus();
  const panel = document.getElementById("tbPanel");
  if (panel) { panel.classList.remove("hidden"); }
}

function closeTbPanel() {
  const panel = document.getElementById("tbPanel");
  if (panel) { panel.classList.add("hidden"); }
}

function toggleTbPanel() {
  if (tbPanelIsOpen()) { closeTbPanel(); }
  else { openTbPanel(); }
}

function applyTbPhoneMode() {
  const toolbar = document.getElementById("toolbar");
  if (!toolbar) { return; }
  const phone = window.innerWidth <= 900;
  if (phone === tbPhoneMode) { return; }
  tbPhoneMode = phone;
  if (phone) {
    tbRelocate();
    toolbar.classList.add("tb-phone");
  } else {
    toolbar.classList.remove("tb-phone");
    tbRestore();
  }
}

/* ----- Insert and More actions ------------------------------------------- */
function runInsertAction(kind) {
  closeToolbarMenus();
  if (kind === "attach") {
    /* startAttachFlow() is the single attach entry point: it performs
       the note, trash, and offline checks and captures the caret before
       opening the picker. (v1.3.4: the old toolbar Attach button is
       gone; this menu item is the way in.) */
    startAttachFlow();
    return;
  }
  if (kind === "scan") {
    /* v2.45: the scan dialog is the attach flow's sibling:
       it performs the same note, trash, and offline checks
       and captures the caret before the dialog opens, so
       the inserted pages land where the caret was. */
    openScanDialog();
    return;
  }
  if (kind === "sketch") {
    /* v2.46: the sketch dialog is the scan dialog's sibling:
       it performs the same note, trash, and offline checks
       and captures the caret before the dialog opens, so
       the inserted sketch lands where the caret was. */
    openSketchDialog();
    return;
  }
  restoreFormatSelection();
  if (kind === "noteLink") {
    /* The picker captures the caret itself (it needs the selection
       for the label decision) and marks dirty only when a link is
       actually inserted, so opening and cancelling changes nothing. */
    openNoteLinkPicker();
    return;
  }
  if (kind === "table") {
    insertStarterTable();
  } else if (kind === "toc") {
    /* v2.37.0: the generated table of contents block (its
       own section below, beside the other block inserts). */
    insertTocBlock();
  } else if (kind === "noteTasks") {
    /* v2.49.0: the generated note tasks block (its own
       section below, beside the table of contents block):
       the marker that this note shows its linked tasks. */
    insertNoteTasksBlock();
  } else if (kind === "codeBlock") {
    insertCodeBlock();
  } else if (kind === "inlineCode") {
    insertInlineCode();
  } else if (kind === "link") {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.getRangeAt(0).collapsed) {
      toast("Select the text to turn into a link first.", true);
      return;
    }
    const url = prompt("Link address (https://...)");
    if (!url) { return; }
    /* The prompt stole focus and may have disturbed the selection, so
       restore the saved range again before creating the link. */
    restoreFormatSelection();
    document.execCommand("createLink", false, url.trim());
    /* v2.6.0: the fresh anchor gets its hover tooltip (its own
       address) at birth, from the same resolver renders use.
       v2.9: the view decoration runs too; a fresh link is a Text
       link, so it is a no-op for it, but the pass keeps the rule
       that both decorations always run together. */
    decorateLinkTooltips(document.getElementById("noteBody"));
    decorateLinkViews(document.getElementById("noteBody"));
  } else if (kind === "divider") {
    document.execCommand("insertHorizontalRule", false, null);
  } else if (kind === "datetime") {
    const text = new Date().toLocaleString(undefined, {
      year: "numeric", month: "long", day: "numeric",
      hour: "numeric", minute: "2-digit"
    });
    document.execCommand("insertText", false, text);
  }
  markDirty();
}

function runMoreAction(kind) {
  closeToolbarMenus();
  /* v2.24.5: on phones these items live in the More panel,
     and a completed action closes it. On desktop the panel is
     never open, so this is a no-op there. */
  closeTbPanel();
  restoreFormatSelection();
  if (kind === "alignLeft") {
    document.execCommand("justifyLeft", false, null);
  } else if (kind === "alignCenter") {
    document.execCommand("justifyCenter", false, null);
  } else if (kind === "alignRight") {
    document.execCommand("justifyRight", false, null);
  } else if (kind === "indent") {
    document.execCommand("indent", false, null);
  } else if (kind === "outdent") {
    document.execCommand("outdent", false, null);
  } else if (kind === "clear") {
    clearFormattingExtended();
  } else if (kind === "encrypt") {
    /* v2.89: passage encryption. The flow is async
       (it may walk the setup or unlock dialog first)
       and marks the note dirty itself when a block
       lands, so this branch returns ahead of the
       shared markDirty below. */
    void ssencEncryptSelectionFlow();
    return;
  }
  markDirty();
}

/* ----- style dropdown follows the caret (best effort) ----------------------
   When the caret sits inside a heading, quote, or code block, the
   style dropdown shows that block type, so the current format is
   visible instead of silently remembered. Plain paragraphs, divs, and
   list items all read as Normal text. */
function updateStyleSelectFromCaret() {
  const bodyEl = document.getElementById("noteBody");
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !bodyEl.contains(sel.anchorNode)) { return; }
  let el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentNode;
  const select = document.getElementById("styleSelect");
  while (el && el !== bodyEl) {
    const tag = el.tagName;
    if (tag === "H1" || tag === "H2" || tag === "H3" ||
        tag === "BLOCKQUOTE" || tag === "PRE") {
      select.value = tag;
      return;
    }
    if (tag === "P" || tag === "DIV" || tag === "LI") {
      select.value = "P";
      return;
    }
    el = el.parentNode;
  }
  select.value = "P";
}
const syncStyleSelect = debounce(updateStyleSelectFromCaret, 120);

/* ----- swatch construction -------------------------------------------------
   Swatch buttons are built from TB_COLORS so both palettes stay in
   sync. A mousedown on a swatch saves the editor selection first (and
   stops the editor losing it), then the click applies the color. */
function buildSwatches(containerId, onPick) {
  const box = document.getElementById(containerId);
  TB_COLORS.forEach(function (c) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch";
    b.title = c.name;
    b.style.background = c.value;
    b.addEventListener("mousedown", function (ev) {
      ev.preventDefault();
      saveFormatSelection();
    });
    b.addEventListener("click", function () { onPick(c.value); });
    box.appendChild(b);
  });
}

/* ----- toolbar wiring (called once from wireEvents) ------------------------
   Complements the generic data-cmd button loop: that loop still wires
   the plain command buttons, while everything with a menu, a select,
   or a palette is wired here. */
function wireToolbar() {
  /* Styled spans instead of font tags for the color commands. */
  try { document.execCommand("styleWithCSS", false, true); }
  catch (err) { /* very old engines ignore this; the span helpers
                   still cover family, size, and color fallbacks */ }

  const toolbarEl = document.getElementById("toolbar");

  /* Selection backstops: any touch of a toolbar control saves the
     editor selection before the control can steal focus. */
  toolbarEl.addEventListener("mousedown", saveFormatSelection);
  toolbarEl.addEventListener("focusin", saveFormatSelection);

  /* Keep the saved range and the style dropdown current while the
     user edits. The caret sync is debounced so fast typing and quick
     click sequences do not thrash the dropdown. */
  document.addEventListener("selectionchange", function () {
    saveFormatSelection();
    syncStyleSelect();
  });

  /* Menu toggles. */
  document.getElementById("insertBtn").addEventListener("click", function () {
    /* v2.24.5: a line menu opening over the phone panel
       replaces it, so the two never stack. */
    if (tbPhoneMode) { closeTbPanel(); }
    toggleToolbarMenu("insertMenu");
  });
  document.getElementById("textColorBtn").addEventListener("click", function () {
    toggleToolbarMenu("textColorMenu");
  });
  document.getElementById("highlightBtn").addEventListener("click", function () {
    if (tbPhoneMode) { closeTbPanel(); }
    toggleToolbarMenu("highlightMenu");
  });
  document.getElementById("moreBtn").addEventListener("click", function () {
    /* v2.24.5: at phone widths More toggles the overflow
       panel; the desktop menu below is untouched. */
    if (tbPhoneMode) { toggleTbPanel(); }
    else { toggleToolbarMenu("moreMenu"); }
  });

  /* Clicking anywhere outside the toolbar closes open menus, and so
     does Escape. Clicks inside the toolbar are handled by their own
     controls. v2.24.5: the phone panel rides along on both rules; it
     sits inside #toolbar, so its own clicks never read as outside. */
  document.addEventListener("click", function (ev) {
    if (!ev.target.closest("#toolbar")) {
      closeToolbarMenus();
      closeTbPanel();
    }
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") {
      closeToolbarMenus();
      closeTbPanel();
    }
  });

  /* Insert and More menu items. */
  document.querySelectorAll("#insertMenu button[data-insert]").forEach(
    function (btn) {
      btn.addEventListener("click", function () {
        runInsertAction(btn.getAttribute("data-insert"));
      });
    });
  document.querySelectorAll("#moreMenu button[data-more]").forEach(
    function (btn) {
      btn.addEventListener("click", function () {
        runMoreAction(btn.getAttribute("data-more"));
      });
    });

  /* Text style dropdown. The chosen value stays selected afterward,
     so what was applied is always visible. */
  document.getElementById("styleSelect").addEventListener("change",
    function (ev) {
      restoreFormatSelection();
      document.execCommand("formatBlock", false, ev.target.value);
      markDirty();
    });

  /* Font pickers. The selects keep showing the applied choice. */
  document.getElementById("fontFamilySelect").addEventListener("change",
    function (ev) {
      applyFontFamily(ev.target.value);
    });
  document.getElementById("fontSizeSelect").addEventListener("change",
    function (ev) {
      if (ev.target.value) { applyFontSize(ev.target.value); }
    });

  /* Color palettes and the preset reset actions. */
  buildSwatches("textColorSwatches", applyTextColor);
  /* v2.6.0: the highlight palette's None swatch is inserted FIRST,
     ahead of the colors buildSwatches appends, so "no background"
     reads as the palette's first choice. It behaves like the other
     swatches (mousedown saves the editor selection, then the click
     applies), and it runs the same full clear as the labeled No
     highlight button below the grid. */
  const hlNoneSwatch = document.createElement("button");
  hlNoneSwatch.type = "button";
  hlNoneSwatch.id = "highlightNoneSwatch";
  hlNoneSwatch.className = "swatch swatch-none";
  hlNoneSwatch.title = "None";
  hlNoneSwatch.setAttribute("aria-label", "None");
  hlNoneSwatch.addEventListener("mousedown", function (ev) {
    ev.preventDefault();
    saveFormatSelection();
  });
  hlNoneSwatch.addEventListener("click", function () {
    clearHighlightSelection();
  });
  document.getElementById("highlightSwatches").appendChild(hlNoneSwatch);
  buildSwatches("highlightSwatches", applyHighlight);
  document.getElementById("textColorDefault").addEventListener("click",
    function () { applyTextColor("inherit"); });
  document.getElementById("highlightNone").addEventListener("click",
    function () { clearHighlightSelection(); });

  /* Custom color inputs (v2.24.2): the full flow lives in
     the custom color block in the colors code (a bookmark at
     the click, a paint at the click, live repaints on the
     picker's input ticks, a commit and remember on its
     change event). The inputs are seeded from the
     remembered colors first; loadSettings has already run. */
  const textCustomInput = document.getElementById("textColorCustom");
  const highlightCustomInput = document.getElementById("highlightCustom");
  textCustomInput.value = state.customTextColor;
  highlightCustomInput.value = state.customHighlightColor;
  textCustomInput.addEventListener("click", function () {
    beginCustomColor("text", textCustomInput);
  });
  highlightCustomInput.addEventListener("click", function () {
    beginCustomColor("highlight", highlightCustomInput);
  });
  textCustomInput.addEventListener("input", function () {
    customColorInput("text", textCustomInput);
  });
  highlightCustomInput.addEventListener("input", function () {
    customColorInput("highlight", highlightCustomInput);
  });
  textCustomInput.addEventListener("change", function () {
    commitCustomColor("text", textCustomInput);
  });
  highlightCustomInput.addEventListener("change", function () {
    commitCustomColor("highlight", highlightCustomInput);
  });

  /* v2.24.5: the phone toolbar's one line form. Apply the
     current width's arrangement now (a phone boot starts
     relocated) and follow the width across the breakpoint
     from here on: rotation, a window resize, and a device
     switch all cross through the same apply. */
  applyTbPhoneMode();
  window.addEventListener("resize", applyTbPhoneMode);
}

