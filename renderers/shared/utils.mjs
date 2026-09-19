// Small text and SVG helpers shared by every renderer.

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Approximate text width without a font engine. Good enough for layout;
// the viewer never needs pixel-perfect measurement.
export function textWidth(text, fontSize = 12, mono = false) {
  const factor = mono ? 0.62 : 0.55;
  return String(text ?? '').length * fontSize * factor;
}

export function fitChars(widthPx, fontSize = 12, mono = false) {
  const factor = mono ? 0.62 : 0.55;
  return Math.max(1, Math.floor(widthPx / (fontSize * factor)));
}

export function truncate(text, maxChars) {
  const s = String(text ?? '');
  if (s.length <= maxChars) return s;
  if (maxChars <= 1) return '…';
  return `${s.slice(0, maxChars - 1)}…`;
}

export function wrapText(text, maxChars, maxLines = 3) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word.length > maxChars ? truncate(word, maxChars) : word;
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = truncate(lines[maxLines - 1], Math.max(1, maxChars - 1));
  }
  return lines;
}

export function attrs(object) {
  return Object.entries(object)
    .filter(([, v]) => v !== undefined && v !== null && v !== false && String(v) !== '')
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`))
    .join('');
}

export function svgText(x, y, text, options = {}) {
  const { cls, anchor, weight, size, mono, fill, dy } = options;
  const style = [
    weight ? `font-weight:${weight}` : '',
    size ? `font-size:${size}px` : '',
    mono ? 'font-family:var(--font-mono)' : '',
    fill ? `fill:${fill}` : '',
  ].filter(Boolean).join(';');
  return `<text${attrs({ x, y, class: cls, 'text-anchor': anchor, style: style || undefined, dy })}>${esc(text)}</text>`;
}

export function nodeAttrs(id, label, extra = {}) {
  return attrs({
    id: `node-${id}`,
    class: extra.class,
    'data-node-id': id,
    'data-node-label': label,
    'data-node-kind': extra.kind,
    tabindex: 0,
    role: 'button',
    'aria-label': label,
  });
}

export function edgeAttrs(edge, index) {
  const id = edge.id || `${edge.from}-${edge.to}-${index}`;
  return attrs({
    id: `edge-${id}`,
    class: 'edge',
    'data-edge-id': id,
    'data-edge-from': edge.from,
    'data-edge-to': edge.to,
    'data-edge-label': edge.label,
    tabindex: 0,
    role: 'button',
    'aria-label': edge.label ? `${edge.label}: ${edge.from} to ${edge.to}` : `${edge.from} to ${edge.to}`,
  });
}

// Coerce a spec-derived layout value to a safe number. Anything that is not
// a finite number inside [min, max] falls back to the default, so a string or
// a negative value can never reach an SVG attribute or an array length.
export function num(value, fallback, { min = 0, max = 100000, integer = false } = {}) {
  const n = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return integer ? Math.floor(n) : n;
}

// Explicit row/col placement is only honoured for small non-negative integers.
export const MAX_CELL = 1000;
export function cellIndex(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_CELL ? value : undefined;
}

export function uniqueBy(items, keyOf) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
