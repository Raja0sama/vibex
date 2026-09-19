import { esc, svgText, nodeAttrs, edgeAttrs, truncate, textWidth, wrapText, fitChars, num, cellIndex } from '../shared/utils.mjs';
import { rowsPlace, bbox, routeOrthogonal, routeSelfLoop, pathFromPoints, placeLabel, portOffsets } from '../shared/layout.mjs';
import { wrapSvg } from '../shared/svgdoc.mjs';

const MARGIN = 40;
const BOUNDARY_PAD = 28;
const BOUNDARY_LABEL_H = 24;
const SIZES = { person: { w: 200, h: 146 }, default: { w: 250, h: 136 } };
const TITLE_PX = 16; const SUB_PX = 12; const DESC_PX = 12.5; const DESC_LH = 16;

function sizeOf(el) {
  const base = el.kind === 'person' ? SIZES.person : SIZES.default;
  const descLines = wrapText(el.description || '', fitChars(base.w - 24, DESC_PX), 3).length;
  return { w: base.w, h: base.h + Math.max(0, descLines - 2) * DESC_LH };
}

// Rank elements by relationship flow so the diagram reads top-to-bottom:
// persons and pure sources on top, sinks at the bottom.
function autoRows(spec) {
  const ids = spec.elements.map((e) => e.id);
  const out = new Map(ids.map((id) => [id, []]));
  const indegree = new Map(ids.map((id) => [id, 0]));
  for (const r of spec.relationships || []) {
    if (r.from === r.to || !out.has(r.from) || !out.has(r.to)) continue;
    out.get(r.from).push(r.to);
    indegree.set(r.to, indegree.get(r.to) + 1);
  }
  const rank = new Map();
  const roots = ids.filter((id) => indegree.get(id) === 0 || spec.elements.find((e) => e.id === id).kind === 'person');
  const queue = roots.length ? roots : ids.slice(0, 1);
  for (const id of queue) rank.set(id, 0);
  const visitedEdges = new Set();
  while (queue.length) {
    const id = queue.shift();
    for (const next of out.get(id)) {
      const key = `${id}>${next}`;
      if (visitedEdges.has(key)) continue;
      visitedEdges.add(key);
      const candidate = rank.get(id) + 1;
      if ((rank.get(next) ?? -1) < candidate && candidate < ids.length) {
        rank.set(next, candidate);
        queue.push(next);
      }
    }
  }
  for (const id of ids) if (!rank.has(id)) rank.set(id, 0);
  // Explicit row wins.
  for (const e of spec.elements) if (cellIndex(e.row) !== undefined) rank.set(e.id, e.row);

  const parentOf = new Map();
  for (const b of spec.boundaries || []) for (const id of b.contains) parentOf.set(id, b.id);
  const chainOf = (id) => { const chain = []; let cur = parentOf.get(id); while (cur && !chain.includes(cur)) { chain.unshift(cur); cur = parentOf.get(cur); } return chain.join('/'); };
  const boundaryOf = new Map(spec.elements.map((e) => [e.id, chainOf(e.id)]));
  const rows = [];
  for (const e of spec.elements) {
    const r = rank.get(e.id);
    (rows[r] ||= []).push(e);
  }
  return rows.filter(Boolean).map((row) => row.sort((a, b) => {
    const ca = cellIndex(a.col); const cb = cellIndex(b.col);
    if (ca !== undefined && cb !== undefined) return ca - cb;
    if (ca !== undefined) return -1;
    if (cb !== undefined) return 1;
    const ba = boundaryOf.get(a.id); const bb = boundaryOf.get(b.id);
    if (ba === bb) return 0;
    if (!ba) return 1; if (!bb) return -1;
    return ba < bb ? -1 : 1;
  }));
}

function renderElement(el, rect) {
  const { x, y, w, h } = rect;
  const kind = el.kind;
  const cls = `node c4 ${kind}${el.external ? ' external' : ''}`;
  let out = `<g${nodeAttrs(el.id, el.label, { class: cls, kind })}>`;
  const tip = [el.label, el.technology ? `[${el.technology}]` : '', el.description || ''].filter(Boolean).join(' — ');
  out += `<title>${esc(tip)}</title>`;
  let textTop = y;
  if (kind === 'person') {
    const headR = 18;
    out += `<circle cx="${x + w / 2}" cy="${y + headR + 2}" r="${headR}"/>`;
    out += `<rect class="box" x="${x}" y="${y + headR * 2 - 6}" width="${w}" height="${h - headR * 2 + 6}" rx="14"/>`;
    textTop = y + headR * 2 + 6;
  } else if (kind === 'database') {
    out += `<rect class="box" x="${x}" y="${y + 10}" width="${w}" height="${h - 10}" rx="10"/>`;
    out += `<ellipse cx="${x + w / 2}" cy="${y + 12}" rx="${w / 2}" ry="12"/>`;
    out += `<path class="db-line" d="M${x} ${y + 12} a${w / 2} 12 0 0 0 ${w} 0"/>`;
    textTop = y + 20;
  } else if (kind === 'queue') {
    out += `<rect class="box" x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}"/>`;
    textTop = y + 8;
  } else {
    out += `<rect class="box" x="${x}" y="${y}" width="${w}" height="${h}" rx="${kind === 'component' ? 6 : 10}"/>`;
    textTop = y + 8;
  }
  const cx = x + w / 2;
  const titleMax = fitChars(w - 24, TITLE_PX);
  out += svgText(cx, textTop + 22, truncate(el.label, titleMax), { cls: 'title', anchor: 'middle' });
  const stereo = `[${el.kind === 'person' ? 'Person' : el.kind[0].toUpperCase() + el.kind.slice(1)}${el.technology ? `: ${el.technology}` : ''}${el.external ? ', external' : ''}]`;
  out += svgText(cx, textTop + 39, truncate(stereo, fitChars(w - 20, SUB_PX)), { cls: 'sub', anchor: 'middle' });
  const lines = wrapText(el.description || '', fitChars(w - 24, DESC_PX), 3);
  lines.forEach((line, i) => { out += svgText(cx, textTop + 62 + i * DESC_LH, line, { cls: 'desc', anchor: 'middle' }); });
  if (el.link) out += svgText(x + w - 10, y + h - 8, '↗ drill down', { cls: 'sub', anchor: 'end' });
  out += '</g>';
  return out;
}

function renderRelationship(rel, index, rects, offset, obstacles) {
  const a = rects.get(rel.from); const b = rects.get(rel.to);
  const route = rel.from === rel.to ? routeSelfLoop(a, offset.from) : routeOrthogonal(a, b, offset);
  const d = pathFromPoints(route.points, 10);
  const cls = `edge c4-rel${rel.style === 'dashed' ? ' dashed' : ''}`;
  const base = edgeAttrs(rel, index);
  const tip = [rel.label, rel.technology ? `[${rel.technology}]` : ''].filter(Boolean).join(' ') || `${rel.from} → ${rel.to}`;
  let edge = `<g${base.replace('class="edge"', `class="${cls}"`)}><title>${esc(tip)}</title>`;
  edge += `<path class="hit" d="${d}"/>`;
  edge += `<path class="line" d="${d}" marker-end="url(#m-arrow)"${rel.direction === 'both' ? ' marker-start="url(#m-arrow)"' : ''}/>`;
  edge += '</g>';
  const lines = [];
  if (rel.label) lines.push({ text: truncate(rel.label, 40), tech: false });
  if (rel.technology) lines.push({ text: `[${truncate(rel.technology, 30)}]`, tech: true });
  let labelSvg = '';
  if (lines.length) {
    const widest = Math.max(...lines.map((l) => textWidth(l.text, l.tech ? 11 : 12.5)));
    const lw = widest + 12; const lh = lines.length * 15 + 6;
    const box = placeLabel(route.points, lw, lh, obstacles);
    obstacles.push({ ...box, label: true });
    labelSvg = `<g${base.replace('class="edge"', 'class="edge-label"').replace(/ id="[^"]*"/, '').replace(' tabindex="0" role="button"', '')}><title>${esc(tip)}</title>`;
    labelSvg += `<rect class="label-bg" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"/>`;
    lines.forEach((l, i) => { labelSvg += svgText(box.x + box.w / 2, box.y + 15 * (i + 1) - 2, l.text, { cls: `label${l.tech ? ' tech' : ''}`, anchor: 'middle' }); });
    labelSvg += '</g>';
  }
  return { edge, labelSvg };
}

export function renderC4(spec) {
  const layout = spec.layout && typeof spec.layout === 'object' ? spec.layout : {};
  const boundaries = spec.boundaries || [];
  const hasBoundaries = boundaries.length > 0;
  const rows = autoRows(spec);
  // Many ranks read better left-to-right on a landscape screen.
  const direction = layout.direction === 'lr' || layout.direction === 'tb' ? layout.direction : (rows.length > 4 ? 'lr' : 'tb');
  const placement = rowsPlace(rows, {
    direction,
    gapX: num(layout.gapX, direction === 'lr' ? 100 : 70) + (hasBoundaries ? BOUNDARY_PAD : 0),
    gapY: num(layout.gapY, direction === 'lr' ? 50 : 80) + (hasBoundaries ? BOUNDARY_PAD + BOUNDARY_LABEL_H : 0),
    originX: MARGIN + (hasBoundaries ? BOUNDARY_PAD * 2 : 0),
    originY: MARGIN + (hasBoundaries ? (BOUNDARY_PAD + BOUNDARY_LABEL_H) * 2 : 0),
    sizeOf,
    align: hasBoundaries ? 'left' : 'center',
  });
  const rects = placement.placed;
  const warnings = [];

  // Boundaries: compute nested first (depth-first), outermost gets the most padding.
  const byId = new Map(boundaries.map((b) => [b.id, b]));
  const boundaryRects = new Map();
  const depthOf = (b, seen = new Set()) => {
    if (seen.has(b.id)) return 0;
    seen.add(b.id);
    const children = b.contains.filter((id) => byId.has(id)).map((id) => byId.get(id));
    return children.length ? 1 + Math.max(...children.map((c) => depthOf(c, seen))) : 0;
  };
  const resolve = (b) => {
    if (boundaryRects.has(b.id)) return boundaryRects.get(b.id);
    const members = b.contains.map((id) => (byId.has(id) ? resolve(byId.get(id)) : rects.get(id))).filter(Boolean);
    const pad = BOUNDARY_PAD - 8 + depthOf(b) * 6;
    const box = bbox(members, pad);
    if (box) { box.y -= BOUNDARY_LABEL_H - 8; box.h += BOUNDARY_LABEL_H - 8; }
    boundaryRects.set(b.id, box);
    return box;
  };
  for (const b of boundaries) resolve(b);
  const insideSome = new Set();
  for (const b of boundaries) for (const id of b.contains) insideSome.add(id);

  let body = '';
  const sorted = [...boundaries].sort((a, b) => depthOf(b) - depthOf(a));
  for (const b of sorted) {
    const box = boundaryRects.get(b.id);
    if (!box) continue;
    const allDescendants = new Set();
    const collect = (bb) => { for (const id of bb.contains) { allDescendants.add(id); if (byId.has(id)) collect(byId.get(id)); } };
    collect(b);
    for (const e of spec.elements) {
      if (allDescendants.has(e.id)) continue;
      const r = rects.get(e.id);
      if (r && r.x < box.x + box.w && r.x + r.w > box.x && r.y < box.y + box.h && r.y + r.h > box.y) {
        warnings.push(`boundary "${b.id}" frame overlaps outside element "${e.id}"; set row/col so boundary members sit together`);
      }
    }
    body += `<g class="boundary" data-boundary-id="${esc(b.id)}" data-node-id="${esc(b.id)}" data-node-label="${esc(b.label)}" data-node-kind="boundary"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"/>`;
    body += svgText(box.x + 12, box.y + 18, b.label, {});
    body += svgText(box.x + 12 + textWidth(b.label, 13) * 1.12 + 8, box.y + 18, `[${b.kind || 'system'} boundary]`, { cls: 'kind' });
    body += '</g>';
  }

  const rels = spec.relationships || [];
  const offsets = portOffsets(rels, rects, 22);
  const obstacles = [...rects.values()].map((r) => ({ x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 }));
  let labels = '';
  // Place the widest labels first so they get the roomy spots.
  const labelSize = (r) => ((r.label || '').length + (r.technology || '').length);
  const order = rels.map((_, i) => i).sort((a, b) => labelSize(rels[b]) - labelSize(rels[a]));
  for (const i of order) { const r = renderRelationship(rels[i], i, rects, offsets[i], obstacles); body += r.edge; labels += r.labelSvg; }
  for (const e of spec.elements) body += renderElement(e, rects.get(e.id));
  body += labels;

  const everything = [...rects.values(), ...[...boundaryRects.values()].filter(Boolean)];
  const extent = bbox(everything, 0);
  const width = extent.x + extent.w + MARGIN + 60;
  const height = extent.y + extent.h + MARGIN;
  const theme = spec.meta.theme === 'dark' ? 'dark' : 'light';
  const svg = wrapSvg({ body, width, height, title: spec.meta.title, theme, diagramType: 'c4' });

  const kinds = new Set(spec.elements.map((e) => (e.external ? 'external' : e.kind)));
  const legendAll = [
    { key: 'person', label: 'Person', style: 'background:var(--person)' },
    { key: 'system', label: 'Software system', style: 'background:var(--system)' },
    { key: 'container', label: 'Container', style: 'background:var(--container)' },
    { key: 'component', label: 'Component', style: 'background:var(--component)' },
    { key: 'database', label: 'Database', style: 'background:var(--container);border-radius:50%' },
    { key: 'queue', label: 'Queue / topic', style: 'background:var(--container);border-radius:8px' },
    { key: 'external', label: 'External (not owned)', style: 'background:var(--external)' },
  ];
  const legend = legendAll.filter((l) => kinds.has(l.key));
  if (rels.some((r) => r.style === 'dashed')) legend.push({ label: 'Dashed arrow = async', className: 'text', glyph: '⇢' });
  return { svg, legend, width, height, warnings };
}
