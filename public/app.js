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
  toc: $("#toc"),
  thread: $("#thread"),
  composer: $("#composer"),
  composerInput: $("#composerInput"),
  sendBtn: $("#sendBtn"),
  expandBtn: $("#expandBtn"),
  nextBtn: $("#nextBtn"),
  newBookBtn: $("#newBookBtn"),
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
    setStatus(`Ready · ${data.chapters.length} chapters`, "");
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
  renderToc();
  els.landing.classList.add("hidden");
  els.reader.classList.remove("hidden");
  els.thread.innerHTML = "";
  addAssistantIntro();
  startChapter(0);
}

// ------------------------- TOC ---------------------------
function renderToc() {
  els.toc.innerHTML = "";
  state.chapters.forEach((c) => {
    const btn = document.createElement("button");
    btn.dataset.index = c.index;
    btn.innerHTML =
      `<span class="num">${String(c.index + 1).padStart(2, "0")}</span>` +
      `<span class="txt">${escapeHtml(c.title)}</span>`;
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

// ------------------------- Chat plumbing -----------------
function addAssistantIntro() {
  const div = document.createElement("div");
  div.className = "msg";
  div.innerHTML = `
    <span class="role">Book Brewery</span>
    <p>Welcome — <strong>${escapeHtml(state.title)}</strong> is on the stove. I split it into
    <strong>${state.chapters.length}</strong> chapters. I'll brew each one into a structured
    learning summary, then pause and ask if you'd like to expand a section or move on.</p>
    <p>Starting with Chapter 1 now…</p>
  `;
  els.thread.appendChild(div);
  scrollThread();
}

function addUserMessage(text) {
  const div = document.createElement("div");
  div.className = "msg user";
  div.innerHTML = `<span class="role">You</span>${renderMarkdown(text)}`;
  els.thread.appendChild(div);
  scrollThread();
}

function addAssistantMessage() {
  const div = document.createElement("div");
  div.className = "msg assistant";
  div.innerHTML = `<span class="role">Book Brewery</span><div class="content"></div>`;
  els.thread.appendChild(div);
  scrollThread();
  return div.querySelector(".content");
}

function scrollThread() {
  els.thread.scrollTop = els.thread.scrollHeight;
}

// ------------------------- Streaming ---------------------
async function streamInto(mount, url, body) {
  state.streaming = true;
  setSendingUi(true);
  let raw = "";
  const cursor = '<span class="cursor" aria-hidden="true"></span>';

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
          mount.innerHTML = renderMarkdown(raw) + cursor;
          scrollThread();
        } else if (event === "error") {
          throw new Error(data?.message || "Stream error");
        }
      }
    }

    mount.innerHTML = renderMarkdown(raw);
    setStatus("Ready", "");
    return raw;
  } catch (err) {
    mount.innerHTML =
      renderMarkdown(raw) +
      `\n\n<p style="color: var(--danger)"><strong>Error:</strong> ${escapeHtml(err.message)}</p>`;
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

  const header = document.createElement("div");
  header.className = "msg user";
  header.innerHTML =
    `<span class="role">You</span>Brew Chapter ${index + 1}: <strong>${escapeHtml(chapter.title)}</strong>.`;
  els.thread.appendChild(header);
  scrollThread();

  const mount = addAssistantMessage();
  const priorChapters = state.chapters
    .slice(0, index)
    .filter((c) => c.done)
    .map((c) => ({ title: c.title, gist: firstSentence(c.summary) }));

  const summary = await streamInto(mount, "/api/summarize", {
    bookId: state.bookId,
    chapterIndex: index,
    priorChapters,
  });

  chapter.summary = summary;
  chapter.done = true;
  updateTocSelection();
}

async function askFollowUp(question) {
  if (state.streaming) return;
  if (state.currentIndex < 0) return;
  const chapter = state.chapters[state.currentIndex];
  addUserMessage(question);
  const mount = addAssistantMessage();
  const summary = await streamInto(mount, "/api/followup", {
    bookId: state.bookId,
    chapterIndex: state.currentIndex,
    previousSummary: chapter.summary,
    question,
  });
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
    addAssistantMessage().innerHTML =
      "<p>That was the last chapter. 🎉 Upload another book from the left when you're ready.</p>";
    return;
  }
  startChapter(next);
});

els.newBookBtn.addEventListener("click", () => {
  if (state.streaming && !confirm("A summary is streaming. Discard and upload a new book?")) return;
  els.reader.classList.add("hidden");
  els.landing.classList.remove("hidden");
  setStatus("Idle");
  state.bookId = null;
  state.title = null;
  state.chapters = [];
  state.currentIndex = -1;
  els.fileInput.value = "";
});

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

// Sentinel for extracted fences; wraps a numeric id and cannot appear in
// user/assistant text because \x1E is a control character.
const FENCE_L = "F";
const FENCE_R = "/F";

function renderMarkdown(src) {
  if (!src) return "";
  let text = src.replace(/\r\n/g, "\n");

  // Extract paired code fences first so their bodies aren't touched by other
  // rules. Accept a space *or* newline after the language tag, so
  // ```html <div…> is still recognized as a diagram (not code).
  const fences = [];
  text = text.replace(/```([a-zA-Z0-9_-]*)[ \t]*\n?([\s\S]*?)```/g, (_m, lang, body) => {
    fences.push({ lang: (lang || "").toLowerCase(), body, closed: true });
    return `${FENCE_L}${fences.length - 1}${FENCE_R}`;
  });
  // Unterminated fence at the tail — render the partial body live during
  // streaming instead of leaving raw markdown visible.
  text = text.replace(/```([a-zA-Z0-9_-]*)[ \t]*\n?([\s\S]*)$/, (_m, lang, body) => {
    fences.push({ lang: (lang || "").toLowerCase(), body, closed: false });
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
    return `<blockquote>${inner}</blockquote>\n`;
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

  // Restore fences.
  const fenceRe = new RegExp(`${FENCE_L}(\\d+)${FENCE_R}`, "g");
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
  } catch (_) {
    setStatus("Server unreachable", "error");
  }
})();
