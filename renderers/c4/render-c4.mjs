import { esc, svgText, nodeAttrs, edgeAttrs, truncate, textWidth, wrapText, fitChars, num, cellIndex } from '../shared/utils.mjs';
import { rowsPlace, bbox, routeOrthogonal, routeSelfLoop, pathFromPoints, placeLabel, portOffsets, channelOffsets } from '../shared/layout.mjs';
import { wrapSvg } from '../shared/svgdoc.mjs';

const MARGIN = 40;
const BOUNDARY_PAD = 28;
const BOUNDARY_LABEL_H = 26;
const WIDTH = { person: 208, default: 248 };
const TITLE_PX = 15; const SUB_PX = 10.5; const DESC_PX = 11.5; const DESC_LH = 15;
// Vertical room the shape itself eats before any text can start.
const SHAPE_TOP = { person: 44, database: 30, default: 16 };
const PAD_BOTTOM = 16;
const DRILL_H = 20;
const LABEL_CHARS = 44; const LABEL_LINES = 2;
const TECH_CHARS = 30;

const DESC_LINES_MIN = 3;
const DESC_LINES_MAX = 5;

// The cap travels as an argument, never as module state: sizing and drawing are
// two passes over the same spec, and a value left over from the last diagram
// would size this one's boxes.
function descLines(el, w, cap) {
  return wrapText(el.description || '', fitChars(w - 28, DESC_PX), cap);
}

// How many lines the wordiest description actually needs, bounded. Wrapping is
// greedy, so the wrap itself is the only honest count — dividing characters by
// line width assumes a perfect pack and comes up a line short. One verbose
// element makes the whole rank taller, which is the honest trade: a long
// description costs height rather than being silently halved.
function descCap(elements) {
  let need = DESC_LINES_MIN;
  for (const el of elements || []) {
    const text = String(el.description || '').trim();
    if (!text) continue;
    const w = el.kind === 'person' ? WIDTH.person : WIDTH.default;
    need = Math.max(need, wrapText(text, fitChars(w - 28, DESC_PX), DESC_LINES_MAX).length);
    if (need >= DESC_LINES_MAX) break;
  }
  return need;
}

// Text block: title baseline, stereotype 16px under it, description 19px under
// that. Returns the height the block needs so boxes can hug their content.
function blockHeight(el, w, cap) {
  const lines = descLines(el, w, cap).length;
  return 15 + 16 + (lines ? 19 + (lines - 1) * DESC_LH + 4 : 0);
}

// One height for every non-person element keeps a rank looking like a row of
// cards instead of a ragged skyline.
function makeSizeOf(elements, cap) {
  let shared = 0;
  for (const el of elements) {
    if (el.kind === 'person') continue;
    const w = WIDTH.default;
    const top = SHAPE_TOP[el.kind] ?? SHAPE_TOP.default;
    shared = Math.max(shared, top + blockHeight(el, w, cap) + (el.link ? DRILL_H : 0) + PAD_BOTTOM);
  }
  shared = Math.max(shared, 104);
  return (el) => {
    if (el.kind === 'person') {
      const w = WIDTH.person;
      const h = SHAPE_TOP.person + blockHeight(el, w, cap) + (el.link ? DRILL_H : 0) + PAD_BOTTOM;
      return { w, h: Math.max(h, 128) };
    }
    return { w: WIDTH.default, h: shared };
  };
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

function renderElement(el, rect, cap) {
  const { x, y, w, h } = rect;
  const kind = el.kind;
  const cls = `node c4 ${kind}${el.external ? ' external' : ''}`;
  let out = `<g${nodeAttrs(el.id, el.label, { class: cls, kind })}>`;
  const tip = [el.label, el.technology ? `[${el.technology}]` : '', el.description || ''].filter(Boolean).join(' — ');
  out += `<title>${esc(tip)}</title>`;
  const cx = x + w / 2;
  let textTop = y + SHAPE_TOP.default;
  // Shapes go in their own group so one drop shadow covers the whole
  // silhouette (head plus body, cylinder plus caps) and never touches text.
  let shape = '';
  if (kind === 'person') {
    // Head clear of the shoulders so the silhouette reads as a person rather
    // than a notched rectangle.
    const headR = 17;
    const bodyY = y + headR * 2;
    shape += `<circle cx="${cx}" cy="${y + headR + 1}" r="${headR}"/>`;
    shape += `<rect class="box" x="${x}" y="${bodyY}" width="${w}" height="${h - (bodyY - y)}" rx="16"/>`;
    textTop = y + SHAPE_TOP.person;
  } else if (kind === 'database') {
    const ry = 11;
    shape += `<rect class="box" x="${x}" y="${y + ry}" width="${w}" height="${h - ry * 2}" rx="0"/>`;
    shape += `<ellipse cx="${cx}" cy="${y + h - ry}" rx="${w / 2}" ry="${ry}"/>`;
    shape += `<ellipse cx="${cx}" cy="${y + ry}" rx="${w / 2}" ry="${ry}"/>`;
    shape += `<path class="db-line" d="M${x} ${y + ry} a${w / 2} ${ry} 0 0 0 ${w} 0"/>`;
    textTop = y + SHAPE_TOP.database;
  } else if (kind === 'queue') {
    const r = Math.min(h / 2, 26);
    shape += `<rect class="box" x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;
  } else {
    shape += `<rect class="box" x="${x}" y="${y}" width="${w}" height="${h}" rx="${kind === 'component' ? 6 : 12}"/>`;
  }

  out += `<g filter="url(#m-shadow)">${shape}</g>`;

  // Centre the text block in the room left between the shape top and the
  // bottom padding, so a one-line description does not leave a void.
  const lines = descLines(el, w, cap);
  const drill = el.link ? DRILL_H : 0;
  const avail = (y + h - PAD_BOTTOM - drill) - textTop;
  const top = textTop + Math.max(0, (avail - blockHeight(el, w, cap)) / 2);

  out += svgText(cx, top + 15, truncate(el.label, fitChars(w - 24, TITLE_PX)), { cls: 'title', anchor: 'middle' });
  const stereo = `[${kind === 'person' ? 'Person' : kind[0].toUpperCase() + kind.slice(1)}${el.technology ? `: ${el.technology}` : ''}${el.external ? ', external' : ''}]`;
  out += svgText(cx, top + 31, truncate(stereo, fitChars(w - 20, SUB_PX)), { cls: 'sub', anchor: 'middle' });
  lines.forEach((line, i) => { out += svgText(cx, top + 50 + i * DESC_LH, line, { cls: 'desc', anchor: 'middle' }); });

  if (el.link) {
    const text = 'Drill down ↗';
    const tw = textWidth(text, 10.5);
    const by = y + h - 11;
    out += `<path class="drill-rule" d="M${cx - tw / 2} ${by + 3.5} H${cx + tw / 2}"/>`;
    out += svgText(cx, by, text, { cls: 'drill', anchor: 'middle' });
  }
  out += '</g>';
  return out;
}

// Closest point on the routed polyline to (px,py) — used to draw a leader when
// obstacle avoidance pushes a label away from its own line.
function nearestOnPath(points, px, py) {
  if (!points || !points.length) return { x: px, y: py, d: 0 };
  let best = { x: points[0][0], y: points[0][1], d: Math.hypot(px - points[0][0], py - points[0][1]) };
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, ay] = points[i]; const [bx, by] = points[i + 1];
    const dx = bx - ax; const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const x = ax + t * dx; const y = ay + t * dy;
    const d = Math.hypot(px - x, py - y);
    if (d < best.d) best = { x, y, d };
  }
  return best;
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
  // The label box is sized from its text, so nothing forced the old 40-char
  // cap; it just threw the rest away. Wrap instead, two lines at most.
  for (const t of wrapText(rel.label || '', LABEL_CHARS, LABEL_LINES)) lines.push({ text: t, tech: false });
  if (rel.technology) lines.push({ text: `[${truncate(rel.technology, TECH_CHARS)}]`, tech: true });
  let labelSvg = '';
  if (lines.length) {
    const widest = Math.max(...lines.map((l) => textWidth(l.text, l.tech ? 10.5 : 11.5)));
    const lw = widest + 14; const lh = lines.length * 14 + 8;
    const box = placeLabel(route.points, lw, lh, obstacles);
    obstacles.push({ ...box, label: true });
    labelSvg = `<g${base.replace('class="edge"', 'class="edge-label"').replace(/ id="[^"]*"/, '').replace(' tabindex="0" role="button"', '')}><title>${esc(tip)}</title>`;
    const mid = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    const near = nearestOnPath(route.points, mid.x, mid.y);
    // Anchor the leader on the box edge nearest the line, not its centre.
    if (near.d > Math.max(box.w, box.h) / 2 + 10) {
      const ax = Math.max(box.x, Math.min(near.x, box.x + box.w));
      const ay = Math.max(box.y, Math.min(near.y, box.y + box.h));
      labelSvg += `<path class="leader" d="M${ax.toFixed(1)} ${ay.toFixed(1)} L${near.x.toFixed(1)} ${near.y.toFixed(1)}"/>`;
    }
    labelSvg += `<rect class="label-bg" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"/>`;
    lines.forEach((l, i) => { labelSvg += svgText(box.x + box.w / 2, box.y + 14 * (i + 1), l.text, { cls: `label${l.tech ? ' tech' : ''}`, anchor: 'middle' }); });
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
  // Before placement: sizeOf measures boxes from this, renderElement fills them
  // from this, and the two have to agree or the text spills out of the box.
  const descCapLines = descCap(spec.elements);
  const placement = rowsPlace(rows, {
    direction,
    gapX: num(layout.gapX, direction === 'lr' ? 100 : 70) + (hasBoundaries ? BOUNDARY_PAD : 0),
    gapY: num(layout.gapY, direction === 'lr' ? 50 : 80) + (hasBoundaries ? BOUNDARY_PAD + BOUNDARY_LABEL_H : 0),
    originX: MARGIN + (hasBoundaries ? BOUNDARY_PAD * 2 : 0),
    originY: MARGIN + (hasBoundaries ? (BOUNDARY_PAD + BOUNDARY_LABEL_H) * 2 : 0),
    sizeOf: makeSizeOf(spec.elements, descCapLines),
    align: hasBoundaries ? 'left' : 'center',
  });
  const rects = placement.placed;
  const warnings = [];

  // Silence is the failure mode this project exists to avoid: if text did not
  // fit, say which text, and where the whole of it can still be read.
  // wrapText collapses runs of whitespace, so both sides are normalised before
  // they are compared — otherwise a description with a newline in it reads as
  // shortened when every word of it survived.
  const norm = (text) => String(text ?? '').trim().split(/\s+/).filter(Boolean).join(' ');
  const wasCut = (full, lines) => Boolean(norm(full)) && lines.join(' ') !== norm(full);
  const cutDesc = (spec.elements || []).filter((el) => {
    const w = el.kind === 'person' ? WIDTH.person : WIDTH.default;
    return wasCut(el.description, descLines(el, w, descCapLines));
  }).map((el) => el.id);
  const cutLabel = (spec.relationships || []).filter((r) => (
    wasCut(r.label, wrapText(r.label || '', LABEL_CHARS, LABEL_LINES))
    || wasCut(r.technology, [truncate(norm(r.technology), TECH_CHARS)])
  )).map((r) => `${r.from}→${r.to}`);
  if (cutDesc.length) warnings.push(`description shortened to fit on ${cutDesc.length} element(s): ${cutDesc.slice(0, 6).join(', ')}${cutDesc.length > 6 ? ', …' : ''} — the full text is in the node tooltip and the details panel`);
  if (cutLabel.length) warnings.push(`edge label or technology shortened to fit on ${cutLabel.length} relationship(s): ${cutLabel.slice(0, 4).join(', ')}${cutLabel.length > 4 ? ', …' : ''} — the full text is in the edge tooltip`);

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
    // The label tag straddles the top edge, so only a little extra headroom.
    if (box) { box.y -= 8; box.h += 8; }
    boundaryRects.set(b.id, box);
    return box;
  };
  for (const b of boundaries) resolve(b);
  const insideSome = new Set();
  for (const b of boundaries) for (const id of b.contains) insideSome.add(id);

  let body = '';
  const maxDepth = boundaries.length ? Math.max(...boundaries.map((b) => depthOf(b))) : 0;
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
    // Deeper boundaries get a more solid frame so nesting is readable at a glance.
    const depth = maxDepth - depthOf(b);
    const kindText = `${b.kind || 'system'} boundary`.toUpperCase();
    const labelW = textWidth(b.label, 12) * 1.12;
    // Uppercase runs wider than textWidth's mixed-case average, and the CSS
    // adds .04em of tracking; measure both or the frame cuts through the tag.
    const kindW = kindText.length * (10.5 * 0.7 + 0.42);
    const tagW = labelW + kindW + 26;
    body += `<g class="boundary depth-${Math.min(depth, 2)}" data-boundary-id="${esc(b.id)}" data-node-id="${esc(b.id)}" data-node-label="${esc(b.label)}" data-node-kind="boundary">`;
    body += `<rect class="frame" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"/>`;
    body += `<rect class="tag" x="${box.x + 10}" y="${box.y - 11}" width="${tagW}" height="22"/>`;
    body += svgText(box.x + 20, box.y + 4, b.label, {});
    body += svgText(box.x + 20 + labelW + 8, box.y + 4, kindText, { cls: 'kind' });
    body += '</g>';
  }

  const rels = spec.relationships || [];
  const offsets = portOffsets(rels, rects, 22);
  const channels = channelOffsets(rels, rects, offsets);
  for (let i = 0; i < rels.length; i += 1) offsets[i].channel = channels[i];
  const obstacles = [...rects.values()].map((r) => ({ x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 }));
  let labels = '';
  // Place the widest labels first so they get the roomy spots.
  const labelSize = (r) => ((r.label || '').length + (r.technology || '').length);
  const order = rels.map((_, i) => i).sort((a, b) => labelSize(rels[b]) - labelSize(rels[a]));
  for (const i of order) { const r = renderRelationship(rels[i], i, rects, offsets[i], obstacles); body += r.edge; labels += r.labelSvg; }
  for (const e of spec.elements) body += renderElement(e, rects.get(e.id), descCapLines);
  body += labels;

  const everything = [...rects.values(), ...[...boundaryRects.values()].filter(Boolean)];
  const extent = bbox(everything, 0);
  const width = extent.x + extent.w + MARGIN + 60;
  const height = extent.y + extent.h + MARGIN;
  const theme = spec.meta.theme === 'dark' ? 'dark' : 'light';
  const svg = wrapSvg({ body, width, height, title: spec.meta.title, theme, diagramType: 'c4', proposed: spec.meta.proposed === true });

  const kinds = new Set(spec.elements.map((e) => (e.external ? 'external' : e.kind)));
  // Swatch shape mirrors the shape on the canvas, colour mirrors its fill.
  const legendAll = [
    { key: 'person', label: 'Person', style: 'background:var(--person);border-radius:7px 7px 4px 4px' },
    { key: 'system', label: 'Software system', style: 'background:var(--system)' },
    { key: 'container', label: 'Container', style: 'background:var(--container)' },
    { key: 'component', label: 'Component', style: 'background:var(--component)' },
    { key: 'database', label: 'Database', style: 'background:var(--database);border-radius:10px/5px' },
    { key: 'queue', label: 'Queue / topic', style: 'background:var(--queue);border-radius:999px' },
    { key: 'external', label: 'External (not owned)', style: 'background:var(--external)' },
  ];
  const legend = legendAll.filter((l) => kinds.has(l.key));
  if (rels.some((r) => r.style === 'dashed')) legend.push({ label: 'Dashed arrow = async', className: 'text', glyph: '⇢' });
  return { svg, legend, width, height, warnings };
}
