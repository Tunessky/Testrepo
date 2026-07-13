// ------------------------- State -------------------------
const state = {
  bookId: null,
  title: null,
  chapters: [], // [{index, title, words, done, summary}]
  currentIndex: -1,
  streaming: false,
};

// ------------------------- Elements ----------------------
const $ = (sel) => document.querySelector(sel);
const els = {
  status: $("#status"),
  landing: $("#landing"),
  reader: $("#reader"),
  dropzone: $("#dropzone"),
  fileInput: $("#fileInput"),
  bookTitle: $("#bookTitle"),
  bookStats: $("#bookStats"),
  toc: $("#toc"),
  thread: $("#thread"),
  composer: $("#composer"),
  composerInput: $("#composerInput"),
  sendBtn: $("#sendBtn"),
  expandBtn: $("#expandBtn"),
  nextBtn: $("#nextBtn"),
  newBookBtn: $("#newBookBtn"),
  printBtn: $("#printBtn"),
  sampleBtn: $("#sampleBtn"),
  progressInline: $("#progressInline"),
  progressText: $("#progressText"),
  progressFill: $("#progressFill"),
};

// ------------------------- Status ------------------------
function setStatus(text, kind = "") {
  els.status.textContent = text;
  els.status.className = `status ${kind}`.trim();
}

// ------------------------- Upload ------------------------
["dragenter", "dragover"].forEach((ev) =>
  els.dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    els.dropzone.classList.add("drag");
  }),
);
["dragleave", "drop"].forEach((ev) =>
  els.dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    els.dropzone.classList.remove("drag");
  }),
);
els.dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) uploadFile(file);
});
els.fileInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) uploadFile(file);
});

async function uploadFile(file) {
  setStatus("Uploading…", "working");
  const form = new FormData();
  form.append("book", file);
  try {
    const resp = await fetch("/api/upload", { method: "POST", body: form });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Upload failed.");
    onBookLoaded(data);
  } catch (err) {
    setStatus(err.message, "error");
    alert(err.message);
  }
}

async function loadSample() {
  setStatus("Loading sample…", "working");
  try {
    const fileResp = await fetch("/sample-book.txt");
    if (!fileResp.ok) throw new Error("Sample not available.");
    const blob = await fileResp.blob();
    const file = new File([blob], "systems-thinking-primer.txt", { type: "text/plain" });
    await uploadFile(file);
  } catch (err) {
    setStatus(err.message, "error");
    alert(err.message);
  }
}

function onBookLoaded({ bookId, title, chapters }) {
  state.bookId = bookId;
  state.title = title;
  state.chapters = chapters.map((c) => ({ ...c, done: false, summary: "" }));
  state.currentIndex = -1;
  els.bookTitle.textContent = title;
  els.bookStats.textContent = bookStatsLabel();
  renderToc();
  updateProgress();
  els.progressInline.classList.remove("hidden");
  els.landing.classList.add("hidden");
  els.reader.classList.remove("hidden");
  els.thread.innerHTML = "";
  addAssistantIntro();
  startChapter(0);
}

function bookStatsLabel() {
  const totalWords = state.chapters.reduce((n, c) => n + (c.words || 0), 0);
  const mins = Math.max(1, Math.round(totalWords / 250));
  return `${state.chapters.length} chapters · ${totalWords.toLocaleString()} words · ~${mins} min brew`;
}

// ------------------------- Reading time ------------------
function readingTime(words) {
  const mins = Math.max(1, Math.round(words / 250));
  return `${mins} min`;
}

// ------------------------- TOC ---------------------------
function renderToc() {
  els.toc.innerHTML = "";
  state.chapters.forEach((c) => {
    const btn = document.createElement("button");
    btn.dataset.index = c.index;
    btn.innerHTML =
      `<span class="num">${String(c.index + 1).padStart(2, "0")}</span>` +
      `<span class="txt">${escapeHtml(c.title)}</span>` +
      `<span class="rtime">${readingTime(c.words || 0)}</span>`;
    btn.addEventListener("click", () => startChapter(c.index));
    els.toc.appendChild(btn);
  });
  updateTocSelection();
}

function updateTocSelection() {
  [...els.toc.querySelectorAll("button")].forEach((btn) => {
    const i = Number(btn.dataset.index);
    btn.classList.toggle("active", i === state.currentIndex);
    btn.classList.toggle("done", !!state.chapters[i]?.done);
  });
}

function updateProgress() {
  const total = state.chapters.length;
  const done = state.chapters.filter((c) => c.done).length;
  const pct = total ? (done / total) * 100 : 0;
  els.progressFill.style.width = `${pct}%`;
  els.progressText.textContent = `${done} / ${total} brewed`;
}

// ------------------------- Chat plumbing -----------------
function addAssistantIntro() {
  const div = document.createElement("div");
  div.className = "msg";
  div.innerHTML = `
    <div class="role"><span>Book Brewery</span></div>
    <div class="content">
      <p>Welcome — <strong>${escapeHtml(state.title)}</strong> is on the stove. I split it into
      <strong>${state.chapters.length}</strong> chapters. I'll brew each one into a structured
      learning summary, then pause and ask if you'd like to expand a section or move on.</p>
      <p>Starting with Chapter 1 now…</p>
    </div>
  `;
  els.thread.appendChild(div);
  scrollThread();
}

function addUserMessage(text) {
  const div = document.createElement("div");
  div.className = "msg user";
  div.innerHTML = `<div class="role"><span>You</span></div>${renderMarkdown(text)}`;
  els.thread.appendChild(div);
  scrollThread();
}

function addAssistantMessage(opts = {}) {
  const withFigures = opts.layout === "summary";
  const div = document.createElement("div");
  div.className = "msg assistant" + (withFigures ? " with-figures" : "");
  if (withFigures) {
    div.innerHTML = `
      <div class="role">
        <span>Book Brewery</span>
        <button type="button" class="copy-btn" title="Copy summary">Copy</button>
      </div>
      <div class="summary-cols">
        <div class="content"></div>
        <aside class="figures" aria-label="Figures"></aside>
      </div>
    `;
  } else {
    div.innerHTML = `
      <div class="role">
        <span>Book Brewery</span>
        <button type="button" class="copy-btn" title="Copy summary">Copy</button>
      </div>
      <div class="content"></div>
    `;
  }
  els.thread.appendChild(div);
  const btn = div.querySelector(".copy-btn");
  btn.addEventListener("click", () => copyMessage(div, btn));
  scrollThread();
  return {
    mount: div.querySelector(".content"),
    figuresMount: div.querySelector(".figures"),
    root: div,
  };
}

// Move each rendered diagram out of the text column and into the figures
// aside, replacing it with a linked [Fig. N] badge at its original position.
// Idempotent — safe to call on every stream delta.
function extractFigures(mount, figuresMount) {
  if (!figuresMount) return;
  figuresMount.innerHTML = "";
  const diagrams = [...mount.querySelectorAll(".diagram")];
  diagrams.forEach((d, i) => {
    const n = i + 1;
    const ref = document.createElement("a");
    ref.className = "figref";
    ref.textContent = `Fig. ${n}`;
    ref.href = `#fig-${n}`;
    ref.setAttribute("aria-label", `See Figure ${n}`);
    d.parentNode.replaceChild(ref, d);

    const fig = document.createElement("figure");
    fig.className = "fig-card";
    fig.id = `fig-${n}`;
    const label = document.createElement("div");
    label.className = "fig-label";
    label.textContent = `Fig. ${n}`;
    fig.appendChild(label);
    fig.appendChild(d);
    figuresMount.appendChild(fig);
  });
}

// Bind once — clicking any [Fig. N] badge scrolls to its figure and pulses.
document.addEventListener("click", (e) => {
  const ref = e.target.closest(".figref");
  if (!ref) return;
  const href = ref.getAttribute("href");
  if (!href || !href.startsWith("#")) return;
  const fig = document.querySelector(href);
  if (!fig) return;
  e.preventDefault();
  fig.scrollIntoView({ behavior: "smooth", block: "center" });
  fig.classList.remove("pulse");
  // eslint-disable-next-line no-void
  void fig.offsetWidth;
  fig.classList.add("pulse");
  setTimeout(() => fig.classList.remove("pulse"), 1200);
});

async function copyMessage(root, btn) {
  const raw = root.dataset.raw || root.querySelector(".content")?.innerText || "";
  try {
    await navigator.clipboard.writeText(raw);
    btn.classList.add("copied");
    btn.textContent = "Copied";
    setTimeout(() => {
      btn.classList.remove("copied");
      btn.textContent = "Copy";
    }, 1500);
  } catch (_) {
    btn.textContent = "Failed";
    setTimeout(() => { btn.textContent = "Copy"; }, 1500);
  }
}

function addChapterPlate(index) {
  const chapter = state.chapters[index];
  if (!chapter) return;
  const div = document.createElement("div");
  div.className = "chapter-plate";
  div.innerHTML = `
    <div class="plate-ornament"><span class="plate-eyebrow">Chapter ${index + 1} of ${state.chapters.length}</span></div>
    <h2>${escapeHtml(chapter.title)}</h2>
    <div class="plate-meta"><strong>${(chapter.words || 0).toLocaleString()}</strong> words · <strong>${readingTime(chapter.words || 0)}</strong> read</div>
  `;
  els.thread.appendChild(div);
  scrollThread();
}

function scrollThread() { els.thread.scrollTop = els.thread.scrollHeight; }

// ------------------------- Streaming ---------------------
async function streamInto(mount, root, url, body, opts = {}) {
  state.streaming = true;
  setSendingUi(true);
  let raw = "";
  const cursor = '<span class="cursor" aria-hidden="true"></span>';
  const figuresMount = opts.figuresMount || null;

  const renderNow = (withCursor) => {
    mount.innerHTML = renderMarkdown(raw) + (withCursor ? cursor : "");
    extractFigures(mount, figuresMount);
  };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const err = await safeJson(resp);
      throw new Error(err?.error || `Request failed (${resp.status})`);
    }
    setStatus("Brewing…", "working");

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const { event, data } = parseSse(chunk);
        if (event === "delta" && data?.text) {
          raw += data.text;
          renderNow(true);
          scrollThread();
        } else if (event === "error") {
          throw new Error(data?.message || "Stream error");
        }
      }
    }

    renderNow(false);
    if (root) root.dataset.raw = raw;
    setStatus(`Ready · ${state.chapters.filter((c) => c.done).length + 1} / ${state.chapters.length}`);
    return raw;
  } catch (err) {
    mount.innerHTML =
      renderMarkdown(raw) +
      `\n\n<p style="color: var(--danger)"><strong>Error:</strong> ${escapeHtml(err.message)}</p>`;
    extractFigures(mount, figuresMount);
    setStatus(err.message, "error");
    return raw;
  } finally {
    state.streaming = false;
    setSendingUi(false);
  }
}

function setSendingUi(sending) {
  els.sendBtn.disabled = sending;
  els.expandBtn.disabled = sending;
  els.nextBtn.disabled = sending;
  els.composerInput.disabled = sending;
}

function parseSse(chunk) {
  const lines = chunk.split("\n");
  let event = "message";
  let dataLine = "";
  for (const line of lines) {
    if (line.startsWith("event: ")) event = line.slice(7).trim();
    else if (line.startsWith("data: ")) dataLine += line.slice(6);
  }
  let data;
  try { data = JSON.parse(dataLine); } catch (_) { data = null; }
  return { event, data };
}

async function safeJson(resp) {
  try { return await resp.json(); } catch (_) { return null; }
}

// ------------------------- Chapter actions ---------------
async function startChapter(index) {
  if (state.streaming) return;
  const chapter = state.chapters[index];
  if (!chapter) return;
  state.currentIndex = index;
  updateTocSelection();
  addChapterPlate(index);

  const { mount, root, figuresMount } = addAssistantMessage({ layout: "summary" });
  const priorChapters = state.chapters
    .slice(0, index)
    .filter((c) => c.done)
    .map((c) => ({ title: c.title, gist: firstSentence(c.summary) }));

  const summary = await streamInto(
    mount,
    root,
    "/api/summarize",
    { bookId: state.bookId, chapterIndex: index, priorChapters },
    { figuresMount },
  );

  chapter.summary = summary;
  chapter.done = true;
  updateTocSelection();
  updateProgress();
}

async function askFollowUp(question) {
  if (state.streaming) return;
  if (state.currentIndex < 0) return;
  const chapter = state.chapters[state.currentIndex];
  addUserMessage(question);
  const { mount, root, figuresMount } = addAssistantMessage({ layout: "summary" });
  const summary = await streamInto(
    mount,
    root,
    "/api/followup",
    {
      bookId: state.bookId,
      chapterIndex: state.currentIndex,
      previousSummary: chapter.summary,
      question,
    },
    { figuresMount },
  );
  chapter.summary = `${chapter.summary}\n\n---\n\n${summary}`;
}

// ------------------------- Composer wiring ---------------
els.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = els.composerInput.value.trim();
  if (!text) return;
  els.composerInput.value = "";
  askFollowUp(text);
});

els.composerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    els.composer.requestSubmit();
  }
});

els.expandBtn.addEventListener("click", () => {
  askFollowUp("Please expand the most important section with deeper analogies and one more worked example.");
});

els.nextBtn.addEventListener("click", () => {
  const next = state.currentIndex + 1;
  if (next >= state.chapters.length) {
    const { mount } = addAssistantMessage({ layout: "single" });
    mount.innerHTML = "<p>That was the last chapter. 🎉 Upload another book from the left when you're ready.</p>";
    return;
  }
  startChapter(next);
});

els.newBookBtn.addEventListener("click", () => {
  if (state.streaming && !confirm("A summary is streaming. Discard and upload a new book?")) return;
  els.reader.classList.add("hidden");
  els.landing.classList.remove("hidden");
  els.progressInline.classList.add("hidden");
  setStatus("Idle");
  state.bookId = null;
  state.title = null;
  state.chapters = [];
  state.currentIndex = -1;
  els.fileInput.value = "";
});

els.printBtn.addEventListener("click", () => window.print());

els.sampleBtn.addEventListener("click", loadSample);

// ------------------------- Utilities ---------------------
function firstSentence(md) {
  if (!md) return "";
  const plain = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_>`-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m = plain.match(/^(.{20,180}?[.!?])\s/);
  return m ? m[1] : plain.slice(0, 140);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Sentinel for extracted fences.
const FENCE_L = "FENCE";
const FENCE_R = "FENCE";

function renderMarkdown(src) {
  if (!src) return "";
  let text = src.replace(/\r\n/g, "\n");

  const fences = [];
  text = text.replace(/```([a-zA-Z0-9_-]*)[ \t]*\n?([\s\S]*?)```/g, (_m, lang, body) => {
    fences.push({ lang: (lang || "").toLowerCase(), body });
    return `${FENCE_L}${fences.length - 1}${FENCE_R}`;
  });
  text = text.replace(/```([a-zA-Z0-9_-]*)[ \t]*\n?([\s\S]*)$/, (_m, lang, body) => {
    fences.push({ lang: (lang || "").toLowerCase(), body });
    return `${FENCE_L}${fences.length - 1}${FENCE_R}`;
  });

  text = escapeHtml(text);

  text = text.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>");
  text = text.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
  text = text.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
  text = text.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  text = text.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  text = text.replace(/^#\s+(.+)$/gm, "<h2>$1</h2>");

  text = text.replace(/^\s*---+\s*$/gm, "<hr />");

  text = text.replace(/^(?:&gt;\s?.*(?:\n|$))+/gm, (block) => {
    const inner = block
      .split("\n")
      .filter(Boolean)
      .map((l) => l.replace(/^&gt;\s?/, ""))
      .join(" ");
    return `<blockquote><p>${inner}</p></blockquote>\n`;
  });

  text = text.replace(/(?:^|\n)((?:[-*]\s+.+(?:\n(?:  +.+))*(?:\n|$))+)/g, (m, block) => {
    const items = block
      .trim()
      .split(/\n(?=[-*]\s+)/)
      .map((it) => it.replace(/^[-*]\s+/, "").replace(/\n\s+/g, " ").trim())
      .map((it) => `<li>${inline(it)}</li>`)
      .join("");
    return `\n<ul>${items}</ul>\n`;
  });
  text = text.replace(/(?:^|\n)((?:\d+\.\s+.+(?:\n|$))+)/g, (m, block) => {
    const items = block
      .trim()
      .split(/\n(?=\d+\.\s+)/)
      .map((it) => it.replace(/^\d+\.\s+/, "").trim())
      .map((it) => `<li>${inline(it)}</li>`)
      .join("");
    return `\n<ol>${items}</ol>\n`;
  });

  const isBlockStart = /^<(h\d|ul|ol|blockquote|hr|pre|div)/;
  text = text
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (isBlockStart.test(trimmed)) return trimmed;
      if (trimmed.includes(FENCE_L)) return trimmed;
      return `<p>${inline(trimmed.replace(/\n/g, " "))}</p>`;
    })
    .join("\n");

  const fenceRe = new RegExp(`${FENCE_L.replace(/[\\^$*+?.()|[\]{}]/g, "\\$&")}(\\d+)${FENCE_R.replace(/[\\^$*+?.()|[\]{}]/g, "\\$&")}`, "g");
  text = text.replace(fenceRe, (_m, i) => {
    const { lang, body } = fences[Number(i)];
    if (lang === "html" || lang === "svg" || lang === "") {
      return `<div class="diagram">${body}</div>`;
    }
    return `<pre><code>${escapeHtml(body)}</code></pre>`;
  });

  return text;
}

function inline(t) {
  return t
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>")
    .replace(/\b(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

// ------------------------- Boot --------------------------
(async function boot() {
  try {
    const resp = await fetch("/api/health");
    const data = await resp.json();
    if (!data.hasKey) {
      setStatus("No API key configured", "error");
    } else {
      setStatus(`Idle · ${data.model}`);
    }
    if (data.authEnabled) {
      const form = document.getElementById("logoutForm");
      if (form) { form.style.display = ""; form.classList.remove("hidden"); }
    }
  } catch (_) {
    setStatus("Server unreachable", "error");
  }
})();
