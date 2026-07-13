const path = require("path");
const os = require("os");
const fs = require("fs");
const crypto = require("crypto");

async function extractChapters({ buffer, ext, fallbackTitle }) {
  switch (ext) {
    case ".pdf":
      return parsePdf(buffer, fallbackTitle);
    case ".epub":
      return parseEpub(buffer, fallbackTitle);
    case ".docx":
      return parseDocx(buffer, fallbackTitle);
    case ".txt":
    case ".md":
    case ".markdown":
      return parseText(buffer.toString("utf8"), fallbackTitle);
    default:
      // Best-effort: try as UTF-8 text.
      return parseText(buffer.toString("utf8"), fallbackTitle);
  }
}

async function parsePdf(buffer, fallbackTitle) {
  const pdfParse = require("pdf-parse");
  const data = await pdfParse(buffer);
  const title = (data.info && (data.info.Title || "").trim()) || fallbackTitle;
  const text = data.text || "";
  return { title, chapters: splitIntoChapters(text) };
}

async function parseDocx(buffer, fallbackTitle) {
  const mammoth = require("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return { title: fallbackTitle, chapters: splitIntoChapters(result.value || "") };
}

function parseText(text, fallbackTitle) {
  return { title: fallbackTitle, chapters: splitIntoChapters(text) };
}

async function parseEpub(buffer, fallbackTitle) {
  const { EPub } = require("epub2");
  // epub2 needs a file path, not a buffer.
  const tmpPath = path.join(
    os.tmpdir(),
    `bookbrewery-${crypto.randomBytes(6).toString("hex")}.epub`,
  );
  fs.writeFileSync(tmpPath, buffer);
  try {
    const epub = await EPub.createAsync(tmpPath);
    const title = (epub.metadata && epub.metadata.title) || fallbackTitle;
    const flowChapters = (epub.flow || []).filter((c) => c && c.id);
    const toc = epub.toc || [];

    const chapters = [];
    for (const item of flowChapters) {
      const html = await new Promise((resolve, reject) => {
        epub.getChapter(item.id, (err, txt) => (err ? reject(err) : resolve(txt || "")));
      });
      const text = htmlToPlain(html);
      if (!text.trim()) continue;
      const tocEntry = toc.find((t) => t.id === item.id) || {};
      const chapterTitle = (tocEntry.title || item.title || item.id || `Section ${chapters.length + 1}`).trim();
      chapters.push({ title: chapterTitle, text });
    }

    if (!chapters.length) {
      // Fallback: dump full text through the generic splitter.
      const full = flowChapters
        .map((c) => c.title || "")
        .join("\n");
      return { title, chapters: splitIntoChapters(full) };
    }

    return { title, chapters: mergeTinyChapters(chapters) };
  } finally {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
}

function htmlToPlain(html) {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|br|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Merge chapters that are too short (< 250 words) into a neighbor so we don't
// fire a summarize call for a two-paragraph copyright page.
function mergeTinyChapters(chapters) {
  const MIN = 250;
  const out = [];
  for (const ch of chapters) {
    const words = ch.text.split(/\s+/).filter(Boolean).length;
    if (words < MIN && out.length) {
      const last = out[out.length - 1];
      last.text = `${last.text}\n\n## ${ch.title}\n\n${ch.text}`;
    } else {
      out.push({ ...ch });
    }
  }
  return out;
}

// Detect chapter boundaries in plain text using common heading patterns.
const CHAPTER_REGEXES = [
  /^\s*chapter\s+(\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b[^\n]*$/im,
  /^\s*part\s+(\d+|[ivxlcdm]+)\b[^\n]*$/im,
  /^\s*section\s+\d+[.:)][^\n]*$/im,
  /^#{1,2}\s+.{1,100}$/m, // Markdown H1/H2 (used as chapter markers in .md files)
  // Deliberately no generic "N. Heading" regex — it fires on numbered list
  // items in body text and produces false chapters.
];

// A PDF's own Table of Contents lists chapter titles followed by a page
// number, e.g. "Chapter 1: The Era of AI Security Engineering  1".
// Strip that so the TOC entry and the real chapter start match by title.
function normalizeTitle(raw) {
  return raw
    .trim()
    .replace(/^#+\s*/, "") // markdown heading markers
    .replace(/\s*\.{2,}\s*\d+\s*$/, "") // "Title ..... 42"
    .replace(/\s+\d{1,4}\s*$/, "") // "Title 42"
    .replace(/\s+/g, " ")
    .trim();
}

function splitIntoChapters(rawText) {
  const text = normalize(rawText);
  if (!text.trim()) return [];

  const lines = text.split(/\n/);
  const boundaries = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (line.length > 120) continue; // Headings are short.
    if (CHAPTER_REGEXES.some((re) => re.test(line))) {
      boundaries.push({ line: i, title: normalizeTitle(line) });
    }
  }

  let chapters = [];
  if (boundaries.length >= 2) {
    for (let i = 0; i < boundaries.length; i++) {
      const start = boundaries[i].line;
      const end = i + 1 < boundaries.length ? boundaries[i + 1].line : lines.length;
      const body = lines.slice(start + 1, end).join("\n").trim();
      if (body) chapters.push({ title: boundaries[i].title, text: body });
    }
    chapters = dedupeByTitle(chapters);
  }

  if (chapters.length < 2) {
    // Fallback: chunk by ~3500 words.
    chapters = chunkByWords(text, 3500).map((chunk, i) => ({
      title: `Section ${i + 1}`,
      text: chunk,
    }));
  }

  return mergeTinyChapters(chapters);
}

// When a book's own Table of Contents lists chapter titles that then repeat
// at the real chapter starts, we end up with two "Chapter 1" entries: one
// tiny (the rest of the TOC after the entry) and one large (the actual
// chapter body). Keep the largest one per title, drop the rest.
function dedupeByTitle(chapters) {
  const byTitle = new Map();
  chapters.forEach((ch, idx) => {
    const words = ch.text.split(/\s+/).filter(Boolean).length;
    const prev = byTitle.get(ch.title);
    if (!prev || words > prev.words) byTitle.set(ch.title, { idx, words });
  });
  const keepIdx = new Set([...byTitle.values()].map((v) => v.idx));
  return chapters.filter((_, idx) => keepIdx.has(idx));
}

function normalize(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function chunkByWords(text, targetWords) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  for (let i = 0; i < words.length; i += targetWords) {
    chunks.push(words.slice(i, i + targetWords).join(" "));
  }
  return chunks;
}

module.exports = { extractChapters };
