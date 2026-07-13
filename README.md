# Book Brewery 🍵

Drop in an ebook. Get a warm, chapter-by-chapter learning summary you can steer.

Book Brewery is a small Node.js/Express web app that:

1. Accepts uploads in **PDF, EPUB, DOCX, TXT, or Markdown** (up to 50 MB).
2. Splits the book into chapters using its own structure (EPUB TOC) or heading heuristics (`Chapter N`, `Part N`, numbered headings, etc.). If none are found, it falls back to fixed-length sections.
3. Sends each chapter to Claude with an **educational content analyst** persona that produces:
   - A brief overview of the chapter's theme
   - Detailed breakdowns of core concepts in plain language
   - Key terminology and definitions
   - Frameworks or models presented
   - Connections to prior chapters
   - Inline HTML/SVG diagrams for any visuals worth showing
4. Pauses after every chapter to ask whether you want to **expand a section**, ask a **follow-up**, or **brew the next chapter**.

## Run it

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm start
# → http://localhost:3000
```

Optional environment variables:

| Variable            | Default            | Purpose                                   |
| ------------------- | ------------------ | ----------------------------------------- |
| `ANTHROPIC_API_KEY` | *(required)*       | API key used to summarize chapters.       |
| `ANTHROPIC_MODEL`   | `claude-opus-4-7`  | Model used for summaries and follow-ups.  |
| `PORT`              | `3000`             | HTTP port.                                |

## What lives where

```
server.js            # Express server, upload + streaming endpoints
lib/parse.js         # Ebook parsers + chapter splitting
lib/prompts.js       # Persona system prompt + per-chapter user prompts
public/index.html    # UI shell
public/style.css     # Warm reading-room theme, light + dark
public/app.js        # Upload, TOC, streaming SSE, tiny Markdown renderer
```

## Notes

- Files are held in memory for the session only — nothing is written to disk.
- The client renders assistant Markdown with a tiny built-in renderer. When the assistant emits a diagram inside a ` ```html ` fence, it is rendered as HTML in a bordered "diagram" card.
- Streaming uses Server-Sent Events; each token arrives as a `delta` event.
