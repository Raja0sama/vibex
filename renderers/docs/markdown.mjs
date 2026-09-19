// A small, deliberately incomplete Markdown renderer.
//
// It exists because narrative in a docs spec is written by an agent, and
// handing agent-written text to a general Markdown library means handing it raw
// HTML too. Everything is escaped first and formatting is applied to the
// escaped text, so no input can produce a tag this file did not write.
//
// Supported: headings, paragraphs, lists, blockquotes, fenced code, tables,
// horizontal rules, and inline bold/italic/code/link. Plus `[[claim-id]]`,
// which is what makes prose here different from prose anywhere else: a
// citation that resolves to a claim and carries that claim's confidence.
import { esc } from '../shared/utils.mjs';
import { isSafeLink } from '../shared/validate.mjs';

export const CITE_RE = /\[\[([a-zA-Z][a-zA-Z0-9_.-]*)\]\]/g;

export function citationsIn(text) {
  const out = [];
  for (const m of String(text || '').matchAll(CITE_RE)) out.push(m[1]);
  return out;
}

function inline(text, cite) {
  // The text arriving here is already escaped, so `<` cannot start a tag.
  let s = text;
  s = s.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  s = s.replace(CITE_RE, (whole, id) => cite(id) ?? whole);
  s = s.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (whole, label, href) => {
    // esc() already turned & into &amp;; unescape only to judge the scheme.
    const raw = href.replace(/&amp;/g, '&');
    if (!isSafeLink(raw)) return label;
    return `<a href="${href}" target="_blank" rel="noreferrer noopener">${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return s;
}

function tableRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}
const isDivider = (line) => /^\s*\|?[\s:-]*-[\s|:-]*\|?\s*$/.test(line) && line.includes('-');

export function renderMarkdown(src, { resolveCitation } = {}) {
  const cite = resolveCitation || (() => null);
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  const para = [];
  const flush = () => {
    if (!para.length) return;
    out.push(`<p>${inline(esc(para.join(' ')), cite)}</p>`);
    para.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { flush(); i += 1; continue; }

    // Fenced code: taken verbatim, escaped, never formatted.
    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence) {
      flush();
      const body = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { body.push(lines[i]); i += 1; }
      i += 1;
      const lang = fence[1] ? ` class="lang-${esc(fence[1])}"` : '';
      out.push(`<pre><code${lang}>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      // h1 is the document title; narrative headings start at h3 so they nest
      // under the section heading the panel already printed.
      const level = Math.min(6, heading[1].length + 2);
      out.push(`<h${level}>${inline(esc(heading[2].trim()), cite)}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { flush(); out.push('<hr>'); i += 1; continue; }

    if (/^\s*>\s?/.test(line)) {
      flush();
      const body = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { body.push(lines[i].replace(/^\s*>\s?/, '')); i += 1; }
      out.push(`<blockquote>${renderMarkdown(body.join('\n'), { resolveCitation })}</blockquote>`);
      continue;
    }

    if (isDivider(lines[i + 1] || '') && line.includes('|')) {
      flush();
      const head = tableRow(line);
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { body.push(tableRow(lines[i])); i += 1; }
      const th = head.map((c) => `<th>${inline(esc(c), cite)}</th>`).join('');
      const tr = body.map((r) => `<tr>${r.map((c) => `<td>${inline(esc(c), cite)}</td>`).join('')}</tr>`).join('');
      out.push(`<div class="tw"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`);
      continue;
    }

    const bullet = /^\s*([-*+]|\d+\.)\s+/.exec(line);
    if (bullet) {
      flush();
      const ordered = /\d/.test(bullet[1]);
      const items = [];
      while (i < lines.length) {
        const m = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (!m) break;
        const parts = [m[1]];
        i += 1;
        // A plain indented line continues the item it follows.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*(?:[-*+]|\d+\.)\s+/.test(lines[i])) {
          parts.push(lines[i].trim());
          i += 1;
        }
        items.push(`<li>${inline(esc(parts.join(' ')), cite)}</li>`);
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }

    para.push(line.trim());
    i += 1;
  }
  flush();
  return out.join('\n');
}
