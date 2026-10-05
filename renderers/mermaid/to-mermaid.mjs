// The same spec as Mermaid text, for places that render Mermaid but not HTML:
// GitHub and GitLab Markdown, Notion, Confluence, most wikis. It is a second
// drawing of the spec, not a round trip: edit the spec, never the .mmd.
import { linksToC4 } from '../links/render-links.mjs';

// Inside a quoted label: quotes and angle brackets become Mermaid entity codes,
// newlines become spaces.
function q(text) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
    .replace(/#/g, '#35;').replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;');
  return `"${s}"`;
}

// Mermaid ids: letters, digits, underscore, never a keyword like `end`.
function idMaker() {
  const used = new Map();
  const taken = new Set();
  return (raw) => {
    if (used.has(raw)) return used.get(raw);
    let base = `n_${String(raw).replace(/[^A-Za-z0-9_]/g, '_')}`;
    let id = base; let n = 2;
    while (taken.has(id)) { id = `${base}_${n}`; n += 1; }
    used.set(raw, id); taken.add(id);
    return id;
  };
}

function header(spec, kind) {
  const id = spec.meta?.id ? ` (${spec.meta.id})` : '';
  return [`---`, `title: ${JSON.stringify(spec.meta?.title || '')}`, `---`, `%% vibeX ${spec.diagram_type}${id}: generated from the spec; edit the spec, not this file`, kind];
}

// ---------- ERD ----------
const LEFT = { one: '||', 'zero-or-one': '|o', many: '}o', 'one-or-many': '}|' };
const RIGHT = { one: '||', 'zero-or-one': 'o|', many: 'o{', 'one-or-many': '|{' };
// erDiagram attribute types and names are bare words.
const word = (s) => { const w = String(s ?? '').replace(/[^A-Za-z0-9_\-[\]()]/g, '_'); return /^[A-Za-z_]/.test(w) ? w : `_${w}`; };
const plain = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/"/g, "'").trim();

function erd(spec) {
  const out = header(spec, 'erDiagram');
  const id = idMaker();
  for (const e of spec.entities) {
    const name = e.name && e.name !== e.id ? `${id(e.id)}[${q(e.name)}]` : id(e.id);
    const rows = (e.columns || []).map((c) => {
      const keys = [c.pk && 'PK', c.fk && 'FK', c.unique && !c.pk && 'UK'].filter(Boolean).join(', ');
      const note = [c.nullable && 'nullable', c.note].filter(Boolean).join('; ');
      return `    ${word(c.type || 'any')} ${word(c.name)}${keys ? ` ${keys}` : ''}${note ? ` "${plain(note)}"` : ''}`;
    });
    for (const v of e.values || []) rows.push(`    enum ${word(v)}`);
    out.push(rows.length ? `  ${name} {\n${rows.join('\n')}\n  }` : `  ${name}`);
  }
  for (const r of spec.relationships || []) {
    const line = r.identifying === false ? '..' : '--';
    const label = r.label || (r.from_column && r.to_column ? `${r.from_column} → ${r.to_column}` : '');
    out.push(`  ${id(r.from)} ${LEFT[r.from_cardinality || 'many']}${line}${RIGHT[r.to_cardinality || 'one']} ${id(r.to)} : "${plain(label)}"`);
  }
  return out.join('\n');
}

// ---------- C4 (and the System view, which is drawn as C4) ----------
const SHAPE = {
  person: (l) => `([${l}])`,
  database: (l) => `[(${l})]`,
  queue: (l) => `{{${l}}}`,
};

function c4(spec) {
  const out = header(spec, `flowchart ${spec.layout?.direction === 'tb' ? 'TB' : 'LR'}`);
  const id = idMaker();
  const boundaries = spec.boundaries || [];
  const byId = new Map(boundaries.map((b) => [b.id, b]));
  const inBoundary = new Set(boundaries.flatMap((b) => b.contains));
  const elements = new Map(spec.elements.map((e) => [e.id, e]));

  const node = (e, pad) => {
    const kind = e.kind === 'person' ? 'Person' : `${e.kind[0].toUpperCase()}${e.kind.slice(1)}`;
    const tag = `[${kind}${e.technology ? `: ${e.technology}` : ''}${e.external ? ', external' : ''}]`;
    const label = q(`<b>${e.label}</b><br/><small>${tag}</small>`).replace(/#lt;(\/?(b|small|br\/))#gt;/g, '<$1>');
    return `${pad}${id(e.id)}${(SHAPE[e.kind] || ((l) => `[${l}]`))(label)}`;
  };
  const emit = (b, pad, seen) => {
    if (seen.has(b.id)) return;
    seen.add(b.id);
    out.push(`${pad}subgraph ${id(b.id)}[${q(`${b.label} (${b.kind || 'system'})`)}]`);
    for (const m of b.contains) {
      if (byId.has(m)) emit(byId.get(m), `${pad}  `, seen);
      else if (elements.has(m)) out.push(node(elements.get(m), `${pad}  `));
    }
    out.push(`${pad}end`);
  };
  for (const e of spec.elements) if (!inBoundary.has(e.id)) out.push(node(e, '  '));
  const nested = new Set(boundaries.flatMap((b) => b.contains.filter((m) => byId.has(m))));
  const seen = new Set();
  for (const b of boundaries) if (!nested.has(b.id)) emit(b, '  ', seen);

  for (const r of spec.relationships || []) {
    const arrow = r.style === 'dashed' ? '-.->' : '-->';
    const both = r.direction === 'both' ? (r.style === 'dashed' ? '<-.->' : '<-->') : arrow;
    const text = [r.label, r.technology && `[${r.technology}]`].filter(Boolean).join(' ');
    out.push(`  ${id(r.from)} ${both}${text ? `|${q(text)}|` : ''} ${id(r.to)}`);
  }
  const kinds = { person: '#08427b', system: '#1168bd', container: '#438dd5', component: '#85bbf0', database: '#438dd5', queue: '#438dd5' };
  for (const [k, fill] of Object.entries(kinds)) out.push(`  classDef ${k} fill:${fill},stroke:#0b4884,color:${k === 'component' ? '#000' : '#fff'}`);
  out.push('  classDef external fill:#999999,stroke:#6b6b6b,color:#fff');
  for (const e of spec.elements) out.push(`  class ${id(e.id)} ${e.external ? 'external' : e.kind}`);
  return out.join('\n');
}

// ---------- lifecycle ----------
function lifecycle(spec) {
  const out = header(spec, 'stateDiagram-v2');
  if (spec.layout?.direction !== 'tb') out.push('  direction LR');
  const id = idMaker();
  for (const s of spec.states) out.push(`  state ${q(s.label || s.id)} as ${id(s.id)}`);
  for (const s of spec.states) if (s.kind === 'initial') out.push(`  [*] --> ${id(s.id)}`);
  for (const t of spec.transitions || []) {
    const event = t.label || t.event || '';
    const head = t.actor && !event.toLowerCase().includes(t.actor.toLowerCase()) ? `${t.actor} · ${event}` : event;
    const text = [head, t.guard && `[${t.guard}]`, t.action && `/ ${t.action}`].filter(Boolean).join(' ');
    out.push(`  ${id(t.from)} --> ${id(t.to)}${text ? ` : ${plain(text).replace(/[:;]/g, ' ').replace(/\s+/g, ' ')}` : ''}`);
  }
  for (const s of spec.states) if (s.kind === 'terminal') out.push(`  ${id(s.id)} --> [*]`);
  out.push('  classDef failure fill:#fde8e8,stroke:#c0392b,color:#7b1d1d');
  out.push('  classDef waiting fill:#fff7e0,stroke:#b7791f,stroke-dasharray:4 3');
  out.push('  classDef terminal fill:#e6f4ea,stroke:#2f855a');
  for (const k of ['failure', 'waiting', 'terminal']) {
    const ids = spec.states.filter((s) => s.kind === k).map((s) => id(s.id));
    if (ids.length) out.push(`  class ${ids.join(',')} ${k}`);
  }
  return out.join('\n');
}

// ---------- endpoints ----------
// Mermaid has no API catalogue, so each group is a box of its routes.
function endpoints(spec) {
  const out = header(spec, 'flowchart LR');
  const id = idMaker();
  const groups = [...(spec.groups || [])];
  const known = new Set(groups.map((g) => g.id));
  if (spec.endpoints.some((e) => !known.has(e.group))) groups.push({ id: '__other', label: 'Other' });
  for (const g of groups) {
    const eps = spec.endpoints.filter((e) => (known.has(e.group) ? e.group : '__other') === g.id);
    if (!eps.length) continue;
    out.push(`  subgraph ${id(`group_${g.id}`)}[${q(g.label || g.id)}]`, '    direction TB');
    for (const e of eps) {
      const label = q(`<b>${e.method}</b> ${e.path}${e.summary ? `<br/><small>${e.summary}</small>` : ''}`).replace(/#lt;(\/?(b|small|br\/))#gt;/g, '<$1>');
      out.push(`    ${id(e.id)}[${label}]`);
    }
    out.push('  end');
  }
  const types = spec.types || [];
  if (types.length) {
    out.push(`  subgraph ${id('__types')}["Types"]`, '    direction TB');
    for (const t of types) {
      const rows = t.kind === 'enum' ? (t.values || []) : (t.fields || []).map((f) => `${f.name}${f.required ? '' : '?'}: ${f.type || 'any'}`);
      const label = q(`<b>${t.name}</b>${rows.length ? `<br/>${rows.join('<br/>')}` : ''}`).replace(/#lt;(\/?(b|br\/))#gt;/g, '<$1>');
      out.push(`    ${id(`type_${t.id}`)}[${label}]`);
    }
    out.push('  end');
  }
  const colors = { GET: '#2f855a', POST: '#2b6cb0', PUT: '#b7791f', PATCH: '#b7791f', DELETE: '#c53030' };
  for (const [m, c] of Object.entries(colors)) {
    const ids = spec.endpoints.filter((e) => e.method === m).map((e) => id(e.id));
    if (ids.length) out.push(`  classDef m_${m} stroke:${c},stroke-width:2px`, `  class ${ids.join(',')} m_${m}`);
  }
  const deprecated = spec.endpoints.filter((e) => e.deprecated).map((e) => id(e.id));
  if (deprecated.length) out.push('  classDef deprecated stroke-dasharray:4 3,color:#888', `  class ${deprecated.join(',')} deprecated`);
  return out.join('\n');
}

const BY_TYPE = { erd, c4, lifecycle, endpoints, links: (spec) => c4({ ...linksToC4(spec), diagram_type: 'links' }) };

export const MERMAID_TYPES = Object.keys(BY_TYPE);

export function toMermaid(spec) {
  const fn = BY_TYPE[spec?.diagram_type];
  return fn ? `${fn(spec)}\n` : null;
}
