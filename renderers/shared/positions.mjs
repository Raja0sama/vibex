// A saved layout is what the viewer's "Save layout" hands back: which spec,
// and where each moved box's top-left corner now sits. It reaches the spec by
// hand, by an agent, or through an intake issue, and all three land here.

export const LAYOUT_VERSION = 1;

// The ids a position may pin. Endpoint rows move with their card, so an
// endpoints spec pins cards: groups, types and the synthetic "Other" card.
export function boxIds(spec) {
  const ids = (list) => (Array.isArray(list) ? list.map((x) => x?.id).filter((id) => typeof id === 'string') : []);
  switch (spec?.diagram_type) {
    case 'erd': return new Set(ids(spec.entities));
    case 'c4': return new Set(ids(spec.elements));
    case 'lifecycle': return new Set(ids(spec.states));
    case 'links': return new Set(ids(spec.services));
    case 'endpoints': {
      const groups = new Set(ids(spec.groups));
      const out = new Set([...groups, ...ids(spec.types)]);
      if ((spec.endpoints || []).some((e) => !e.group || !groups.has(e.group))) out.add('default');
      return out;
    }
    default: return new Set();
  }
}

// Accepts the saved JSON itself, or any text holding it in a ```json fence
// (an issue body, a chat message pasted into a file).
export function parseLayout(text) {
  const raw = String(text || '').trim();
  const candidates = [raw, ...[...raw.matchAll(/```json[ \t]*\n([\s\S]*?)```/g)].map((m) => m[1])];
  for (const c of candidates) {
    let data;
    try { data = JSON.parse(c); } catch { continue; }
    if (data && typeof data === 'object' && data.positions && typeof data.positions === 'object') return data;
  }
  return null;
}

// Positions that point at no box, or are not [x, y] numbers, are reported and
// left out rather than written: a typo should not become a silent stale pin.
export function checkLayoutAgainst(spec, layout) {
  const known = boxIds(spec);
  const good = {};
  const unknown = [];
  const invalid = [];
  for (const [id, p] of Object.entries(layout.positions || {})) {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((v) => typeof v === 'number' && Number.isFinite(v))) invalid.push(id);
    else if (!known.has(id)) unknown.push(id);
    else good[id] = [Math.round(p[0]), Math.round(p[1])];
  }
  const specId = spec.meta?.id;
  const wrongSpec = Boolean(layout.spec && specId && layout.spec !== specId);
  return { good, unknown, invalid, wrongSpec };
}

export function applyLayout(spec, positions, { replace = false } = {}) {
  const layout = spec.layout && typeof spec.layout === 'object' ? spec.layout : {};
  const merged = replace ? { ...positions } : { ...(layout.positions || {}), ...positions };
  spec.layout = { ...layout, positions: merged };
  if (!Object.keys(merged).length) delete spec.layout.positions;
  if (!Object.keys(spec.layout).length) delete spec.layout;
  return spec;
}

// Where a top-level key's value sits in the JSON text: [start, end) offsets,
// or null. Skips strings so a brace inside one does not count.
function topLevelValue(text, key) {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      if (depth === 1 && text.slice(i + 1, j) === key && /^\s*:/.test(text.slice(j + 1))) {
        let start = text.indexOf(':', j) + 1;
        while (/\s/.test(text[start])) start += 1;
        let d = 0; let k = start;
        for (; k < text.length; k += 1) {
          const ch = text[k];
          if (ch === '"') { k += 1; while (k < text.length && text[k] !== '"') k += text[k] === '\\' ? 2 : 1; continue; }
          if (ch === '{' || ch === '[') d += 1;
          else if (ch === '}' || ch === ']') { if (d === 0) break; d -= 1; if (d === 0) { k += 1; break; } }
          else if (ch === ',' && d === 0) break;
        }
        return [start, k];
      }
      i = j;
    } else if (c === '{' || c === '[') depth += 1;
    else if (c === '}' || c === ']') depth -= 1;
  }
  return null;
}

function layoutJson(layout, indent) {
  const inline = (v) => JSON.stringify(v).replace(/^\{/, '{ ').replace(/\}$/, ' }').replace(/":/g, '": ').replace(/,"/g, ', "').replace(/,(-?\d)/g, ', $1');
  const ids = Object.keys(layout.positions || {});
  const rest = Object.entries(layout).filter(([k]) => k !== 'positions');
  if (!ids.length) return inline(layout);
  const pad = indent + '  ';
  const lines = rest.map(([k, v]) => `${pad}${JSON.stringify(k)}: ${inline(v)}`);
  lines.push(`${pad}"positions": {\n${ids.map((id) => `${pad}  ${JSON.stringify(id)}: [${layout.positions[id].join(', ')}]`).join(',\n')}\n${pad}}`);
  return `{\n${lines.join(',\n')}\n${indent}}`;
}

// Writes spec.layout back into the original text and leaves every other byte
// alone, so a saved layout is a small diff, not a reformatted file.
export function spliceLayout(text, spec) {
  const indent = (/\n([ \t]+)"/.exec(text) || [, '  '])[1];
  const span = topLevelValue(text, 'layout');
  if (!spec.layout) {
    if (!span) return text;
    const keyStart = text.lastIndexOf('"layout"', span[0]);
    const before = text.slice(0, keyStart).replace(/,?\s*$/, '');
    const after = text.slice(span[1]).replace(/^\s*,/, '');
    const comma = /\{$/.test(before) || /^\s*\}/.test(after) ? '' : ',';
    return before + comma + after;
  }
  const value = layoutJson(spec.layout, indent);
  if (span) return text.slice(0, span[0]) + value + text.slice(span[1]);
  const close = text.lastIndexOf('}');
  const body = text.slice(0, close).replace(/\s*$/, '');
  return `${body},\n${indent}"layout": ${value}\n${text.slice(close)}`;
}
