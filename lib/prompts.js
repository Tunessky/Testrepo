const SYSTEM_PROMPT = `Adopt the role of an expert educational content analyst and learning facilitator who specializes in breaking down complex academic and professional materials into digestible, comprehensible segments. Your primary objective is to create comprehensive chapter-by-chapter summaries that transform dense content into clear, structured learning materials in an organized, step-by-step format.

Analyze each chapter thoroughly, identify core concepts, extract key principles, and present information in a logical hierarchy that builds understanding progressively. Break down complex ideas into fundamental components, use analogies and real life use cases where possible and examples to clarify difficult concepts, and ensure each summary stands alone while connecting to the broader document narrative. Take a deep breath and work on this problem step-by-step.

For each chapter, structure the summary with:
- A brief overview of the chapter's main theme.
- Detailed breakdowns of core concepts with explanations in simple language.
- Identification of key terminology with definitions.
- Explanation of any frameworks or models presented.
- Connections to previous chapters when relevant.

When diagrams, charts, or visual elements are present or implied, provide a self-contained HTML visual (inline SVG or styled HTML — no external assets, no scripts), describe what the diagram shows, and then explain what it represents, why it matters, and how it connects to surrounding concepts.

Formatting rules:
- Use Markdown with clear headings (##, ###) and bullet points for concept breakdowns.
- Wrap any HTML diagram or visual in a fenced code block tagged \`\`\`html so the client can render it.
- Keep prose tight and pedagogical — assume the reader is smart but new to the material.
- After the summary, ALWAYS close with this exact question on its own line:

**Are you satisfied with this summary? Would you like me to expand on any concepts, or shall we proceed to the next chapter?**`;

function truncate(text, maxChars = 60000) {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.7));
  const tail = text.slice(-Math.floor(maxChars * 0.25));
  return `${head}\n\n[... middle of chapter truncated for length ...]\n\n${tail}`;
}

function buildChapterUserPrompt({
  bookTitle,
  chapterIndex,
  totalChapters,
  chapterTitle,
  chapterText,
  priorChapters = [],
}) {
  const priorContext = priorChapters.length
    ? `\n\nFor context, the previous chapters covered:\n${priorChapters
        .map((c, i) => `- Chapter ${i + 1}: ${c.title}${c.gist ? ` — ${c.gist}` : ""}`)
        .join("\n")}`
    : "";

  return `Book: **${bookTitle}**
Chapter ${chapterIndex + 1} of ${totalChapters}: **${chapterTitle}**${priorContext}

Produce a comprehensive, chapter-by-chapter learning summary for the chapter content below, following the required structure and formatting rules. If the chapter references figures/diagrams/tables, invent a faithful HTML/SVG representation that captures the concept.

--- CHAPTER TEXT START ---
${truncate(chapterText)}
--- CHAPTER TEXT END ---`;
}

function buildFollowUpPrompt({ bookTitle, chapterTitle, chapterText, previousSummary, question }) {
  return `Book: **${bookTitle}** — Chapter: **${chapterTitle}**

You previously produced this summary for the reader:

--- PREVIOUS SUMMARY START ---
${previousSummary || "(none)"}
--- PREVIOUS SUMMARY END ---

The reader has asked a follow-up:

"${question}"

Respond in the same pedagogical voice and formatting rules. If they asked you to expand a section, deepen only that section with more analogies, examples, and diagrams as needed. If they asked a clarifying question, answer it directly. Do NOT re-emit the full summary unless explicitly asked. Close with the standard prompt:

**Are you satisfied with this summary? Would you like me to expand on any concepts, or shall we proceed to the next chapter?**

Reference the chapter text as needed:

--- CHAPTER TEXT START ---
${truncate(chapterText)}
--- CHAPTER TEXT END ---`;
}

module.exports = {
  SYSTEM_PROMPT,
  buildChapterUserPrompt,
  buildFollowUpPrompt,
};
