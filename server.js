const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Anthropic = require("@anthropic-ai/sdk");

const { extractChapters } = require("./lib/parse");
const { SYSTEM_PROMPT, buildChapterUserPrompt, buildFollowUpPrompt } = require("./lib/prompts");
const {
  isAuthEnabled,
  isAuthenticated,
  requireAuth,
  checkPassword,
  issueCookie,
  clearCookie,
  loginPageHtml,
} = require("./lib/auth");

const app = express();
const PORT = process.env.PORT || 3000;

// Trust the Render / proxied X-Forwarded-Proto so the session cookie can be
// marked Secure when served over HTTPS.
app.set("trust proxy", 1);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false, limit: "16kb" }));

// Login endpoints must be reachable *before* the auth gate.
app.get("/login", (req, res) => {
  if (isAuthenticated(req)) return res.redirect("/");
  res.type("html").send(loginPageHtml({ redirect: "/" }));
});
app.post("/login", (req, res) => {
  const password = req.body?.password || "";
  const redirect =
    typeof req.body?.redirect === "string" && req.body.redirect.startsWith("/") && !req.body.redirect.startsWith("//")
      ? req.body.redirect
      : "/";
  if (checkPassword(password)) {
    issueCookie(res, req);
    res.redirect(redirect);
  } else {
    res.status(401).type("html").send(loginPageHtml({ error: "Wrong password.", redirect }));
  }
});
app.post("/logout", (req, res) => {
  clearCookie(res);
  res.redirect("/login");
});

// Gate everything below.
app.use(requireAuth);
app.use(express.static(path.join(__dirname, "public")));

// In-memory session store: bookId -> { title, chapters: [{title, text}] }
const books = new Map();

function newBookId() {
  return crypto.randomBytes(8).toString("hex");
}

function getClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    model: process.env.ANTHROPIC_MODEL || "claude-opus-4-7",
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
    authEnabled: isAuthEnabled(),
  });
});

app.post("/api/upload", upload.single("book"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });
    const originalName = req.file.originalname || "Untitled";
    const ext = path.extname(originalName).toLowerCase();

    const { title, chapters } = await extractChapters({
      buffer: req.file.buffer,
      ext,
      fallbackTitle: path.basename(originalName, ext),
    });

    if (!chapters.length) {
      return res.status(422).json({ error: "Could not extract any readable content from this file." });
    }

    const bookId = newBookId();
    books.set(bookId, { title, chapters });

    res.json({
      bookId,
      title,
      chapters: chapters.map((c, i) => ({
        index: i,
        title: c.title,
        words: c.text.split(/\s+/).filter(Boolean).length,
      })),
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err.message || "Failed to process file." });
  }
});

async function streamMessage(res, client, model, systemPrompt, messages) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const stream = client.messages.stream({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    });

    stream.on("text", (chunk) => send("delta", { text: chunk }));
    stream.on("error", (err) => {
      console.error("stream error:", err);
      send("error", { message: err.message || "Stream failed." });
      res.end();
    });
    await stream.finalMessage();
    send("done", {});
    res.end();
  } catch (err) {
    console.error("streamMessage error:", err);
    send("error", { message: err.message || "Request failed." });
    res.end();
  }
}

app.post("/api/summarize", async (req, res) => {
  const { bookId, chapterIndex, priorChapters = [] } = req.body || {};
  const book = books.get(bookId);
  if (!book) return res.status(404).json({ error: "Book not found. Please re-upload." });
  const chapter = book.chapters[chapterIndex];
  if (!chapter) return res.status(404).json({ error: "Chapter not found." });

  const client = getClient();
  if (!client) {
    return res.status(500).json({
      error:
        "ANTHROPIC_API_KEY is not configured on the server. Add it to your environment and restart.",
    });
  }

  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-7";
  const userPrompt = buildChapterUserPrompt({
    bookTitle: book.title,
    chapterIndex,
    totalChapters: book.chapters.length,
    chapterTitle: chapter.title,
    chapterText: chapter.text,
    priorChapters,
  });

  await streamMessage(res, client, model, SYSTEM_PROMPT, [
    { role: "user", content: userPrompt },
  ]);
});

app.post("/api/followup", async (req, res) => {
  const { bookId, chapterIndex, previousSummary, question } = req.body || {};
  const book = books.get(bookId);
  if (!book) return res.status(404).json({ error: "Book not found. Please re-upload." });
  const chapter = book.chapters[chapterIndex];
  if (!chapter) return res.status(404).json({ error: "Chapter not found." });

  const client = getClient();
  if (!client) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server." });
  }

  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-7";
  const userPrompt = buildFollowUpPrompt({
    bookTitle: book.title,
    chapterTitle: chapter.title,
    chapterText: chapter.text,
    previousSummary,
    question,
  });

  await streamMessage(res, client, model, SYSTEM_PROMPT, [
    { role: "user", content: userPrompt },
  ]);
});

app.listen(PORT, () => {
  console.log(`Book Brewery running on http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("⚠  ANTHROPIC_API_KEY not set — uploads will work, summaries will not.");
  }
  if (!isAuthEnabled()) {
    console.warn("⚠  AUTH_PASSWORD not set — the app is open to anyone who reaches this URL.");
  } else {
    console.log("🔒 Password protection is on.");
  }
});
