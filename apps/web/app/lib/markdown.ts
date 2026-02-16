"use client";

/**
 * Lightweight markdown-to-HTML renderer for grading feedback.
 *
 * Supports: headings, bold, italic, inline code, code blocks,
 * unordered/ordered lists, paragraphs, and line breaks.
 *
 * Reason: avoid pulling in a heavy markdown library (remark / react-markdown)
 * just for rendering short grading feedback text.
 */

// Reason: escaping HTML entities to prevent XSS from user-generated content.
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Render inline markdown: bold, italic, inline code */
const inlineRender = (text: string): string => {
  let out = esc(text);
  // inline code (must come before bold/italic to avoid conflicts)
  out = out.replace(/`([^`]+)`/g, '<code style="background:rgba(15,23,42,0.07);padding:2px 5px;border-radius:4px;font-size:0.9em">$1</code>');
  // bold + italic
  out = out.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  // bold
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // italic
  out = out.replace(/\*(.+?)\*/g, "<em>$1</em>");
  return out;
};

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.trimStart().startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(esc(lines[i]));
        i++;
      }
      i++; // skip closing ```
      html.push(
        `<pre style="white-space:pre-wrap;background:#0b1020;color:#dbeafe;padding:12px;border-radius:12px;overflow:auto;margin:8px 0">${codeLines.join("\n")}</pre>`
      );
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const sizes: Record<number, string> = { 1: "1.3em", 2: "1.15em", 3: "1em", 4: "0.95em" };
      html.push(
        `<p style="font-weight:600;font-size:${sizes[level] ?? "1em"};margin:10px 0 4px">${inlineRender(headingMatch[2])}</p>`
      );
      i++;
      continue;
    }

    // Unordered list block
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inlineRender(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`);
        i++;
      }
      html.push(`<ul style="margin:6px 0;padding-left:20px">${items.join("")}</ul>`);
      continue;
    }

    // Ordered list block
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(`<li>${inlineRender(lines[i].replace(/^\s*\d+[.)]\s+/, ""))}</li>`);
        i++;
      }
      html.push(`<ol style="margin:6px 0;padding-left:20px">${items.join("")}</ol>`);
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Regular paragraph
    html.push(`<p style="margin:6px 0;line-height:1.6">${inlineRender(line)}</p>`);
    i++;
  }

  return html.join("");
}
