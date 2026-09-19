import { esc, svgText, nodeAttrs, edgeAttrs, truncate, textWidth, fitChars, num } from '../shared/utils.mjs';
import { gridPlace, bbox, routeOrthogonal, routeSelfLoop, pathFromPoints, placeLabel, portOffsets } from '../shared/layout.mjs';
import { wrapSvg } from '../shared/svgdoc.mjs';

const ROW_H = 20;
const HEAD_H = 36;
const PAD_X = 10;
const MIN_W = 190;
const MAX_W = 380;
const MARGIN = 40;
const GROUP_PAD = 26;
const GROUP_LABEL_H = 22;

function badgesOf(c) {
  return [c.pk ? 'PK' : null, c.fk ? 'FK' : null, !c.pk && c.unique ? 'UQ' : null].filter(Boolean);
}
function badgeWidth(badges) {
  return badges.length ? textWidth(badges.join(','), 9, true) + 6 : 0;
}

function rowsOf(entity) {
  if (entity.kind === 'enum') return (entity.values || []).map((v) => ({ name: v, type: '' }));
  return entity.columns || [];
}

function sizeOf(entity) {
  const rows = rowsOf(entity);
  let widest = textWidth(entity.name, 13) + 40 + textWidth(entity.kind && entity.kind !== 'table' ? entity.kind : (entity.schema || ''), 10.5);
  for (const c of rows) {
    const w = PAD_X + badgeWidth(badgesOf(c)) + textWidth(c.name, 12, true) + 18 + textWidth(c.type || '', 10.5, true) + PAD_X;
    widest = Math.max(widest, w);
  }
  const w = Math.min(MAX_W, Math.max(MIN_W, Math.ceil(widest)));
  const h = HEAD_H + Math.max(1, rows.length) * ROW_H + 6;
  return { w, h };
}

function renderEntity(entity, rect) {
  const rows = rowsOf(entity);
  const { x, y, w, h } = rect;
  const kindTag = entity.kind && entity.kind !== 'table' ? entity.kind : (entity.schema || '');
  let out = `<g${nodeAttrs(entity.id, entity.name, { class: `node erd-entity kind-${entity.kind || 'table'}`, kind: entity.kind || 'table' })}>`;
  out += `<title>${esc(entity.name)}${entity.description ? ` — ${esc(entity.description)}` : ''}</title>`;
  out += `<rect class="box" x="${x}" y="${y}" width="${w}" height="${h}" rx="8"/>`;
  out += `<path class="head" d="M${x} ${y + 8} a8 8 0 0 1 8 -8 h${w - 16} a8 8 0 0 1 8 8 v${HEAD_H - 8} h${-w} z"/>`;
  out += `<line class="row-sep" x1="${x}" y1="${y + HEAD_H}" x2="${x + w}" y2="${y + HEAD_H}" style="stroke:var(--border)"/>`;
  const titleMax = fitChars(w - PAD_X * 2 - (kindTag ? textWidth(kindTag, 10.5) + 8 : 0), 13);
  out += svgText(x + PAD_X, y + 23, truncate(entity.name, titleMax), { cls: 'title' });
  if (kindTag) out += svgText(x + w - PAD_X, y + 23, kindTag, { cls: 'sub', anchor: 'end' });
  let ry = y + HEAD_H;
  if (!rows.length) {
    out += svgText(x + PAD_X, ry + 14, entity.kind === 'enum' ? '(no values)' : '(no columns)', { cls: 'row-type' });
  }
  rows.forEach((c, i) => {
    const badges = badgesOf(c);
    const badgeText = badges.join(',');
    const badgeW = badgeWidth(badges);
    const typeText = c.type || '';
    const typeW = textWidth(typeText, 10.5, true);
    const nameMax = fitChars(w - PAD_X * 2 - badgeW - typeW - 12, 12, true);
    const nameText = `${truncate(c.name, nameMax)}${c.nullable ? '?' : ''}`;
    const rowTitle = [c.name, typeText, c.pk ? 'primary key' : '', c.fk ? `→ ${c.fk}` : '', c.nullable ? 'nullable' : '', c.default ? `default ${c.default}` : '', c.note || ''].filter(Boolean).join(' · ');
    out += `<g class="row" data-column="${esc(c.name)}"><title>${esc(rowTitle)}</title>`;
    if (i > 0) out += `<line class="row-sep" x1="${x + 1}" y1="${ry}" x2="${x + w - 1}" y2="${ry}"/>`;
    if (badges.length) out += svgText(x + PAD_X, ry + 14, badgeText, { cls: `badge ${c.pk ? 'pk' : c.fk ? 'fk' : 'uq'}` });
    out += svgText(x + PAD_X + badgeW, ry + 14, nameText, { cls: `row-text${c.pk ? ' pk' : ''}`, weight: c.pk ? 700 : undefined });
    if (typeText) out += svgText(x + w - PAD_X, ry + 14, typeText, { cls: 'row-type', anchor: 'end' });
    out += '</g>';
    ry += ROW_H;
  });
  out += '</g>';
  return out;
}

function markerFor(cardinality) {
  return `url(#m-${cardinality || 'one'})`;
}

function renderRelationship(rel, index, rects, offset, obstacles) {
  const a = rects.get(rel.from); const b = rects.get(rel.to);
  const route = rel.from === rel.to ? routeSelfLoop(a, offset.from) : routeOrthogonal(a, b, offset);
  const d = pathFromPoints(route.points, 10);
  const fromCard = rel.from_cardinality || 'many';
  const toCard = rel.to_cardinality || 'one';
  const cls = `edge erd-rel${rel.identifying === false ? ' dashed' : ''}`;
  const base = edgeAttrs(rel, index);
  const label = rel.label || '';
  const colLabel = rel.from_column && rel.to_column ? `${rel.from_column} → ${rel.to_column}` : (rel.from_column || '');
  const tip = [label, colLabel, `${fromCard} ↔ ${toCard}`, rel.on_delete ? `on delete ${rel.on_delete}` : ''].filter(Boolean).join(' · ');
  let edge = `<g${base.replace('class="edge"', `class="${cls}"`)} data-from-cardinality="${fromCard}" data-to-cardinality="${toCard}"><title>${esc(tip)}</title>`;
  edge += `<path class="hit" d="${d}"/>`;
  edge += `<path class="line" d="${d}" marker-start="${markerFor(fromCard)}" marker-end="${markerFor(toCard)}"/>`;
  edge += '</g>';
  let labelSvg = '';
  if (label || colLabel) {
    const lines = [label, colLabel].filter(Boolean);
    const widest = Math.max(...lines.map((l, i) => textWidth(l, i === 0 && label ? 10.5 : 9.5, i === 1 || !label)));
    const lw = widest + 12; const lh = lines.length * 13 + 6;
    const box = placeLabel(route.points, lw, lh, obstacles);
    obstacles.push({ ...box, label: true });
    labelSvg = `<g${base.replace('class="edge"', 'class="edge-label"').replace(/ id="[^"]*"/, '').replace(' tabindex="0" role="button"', '')}><title>${esc(tip)}</title>`;
    labelSvg += `<rect class="label-bg" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"/>`;
    lines.forEach((l, i) => {
      const isCol = !(i === 0 && label);
      labelSvg += svgText(box.x + box.w / 2, box.y + 13 * (i + 1) - 1, l, { cls: `label${isCol ? ' tech mono' : ''}`, anchor: 'middle' });
    });
    labelSvg += '</g>';
  }
  return { edge, labelSvg };
}

export function renderErd(spec) {
  const layout = spec.layout && typeof spec.layout === 'object' ? spec.layout : {};
  const gapX = num(layout.gapX, 90); const gapY = num(layout.gapY, 70);
  const cols = num(layout.cols, undefined, { min: 1, integer: true });
  const groups = spec.groups || [];
  const grouped = new Map();
  for (const g of groups) for (const id of g.entities) grouped.set(id, g.id);

  // Keep group members adjacent in auto placement order.
  const ordered = [...spec.entities].sort((a, b) => {
    const ga = grouped.get(a.id) || ''; const gb = grouped.get(b.id) || '';
    if (ga === gb) return 0;
    if (!ga) return 1; if (!gb) return -1;
    return groups.findIndex((g) => g.id === ga) - groups.findIndex((g) => g.id === gb);
  });
  const hasGroups = groups.length > 0;
  let rects;
  if (!hasGroups) {
    rects = gridPlace(ordered, { cols, gapX, gapY, originX: MARGIN, originY: MARGIN, sizeOf }).placed;
  } else {
    // Each group is laid out as its own block, then blocks flow left-to-right
    // and wrap. Ungrouped entities form a trailing block.
    const blocks = [];
    for (const g of groups) blocks.push({ id: g.id, items: spec.entities.filter((e) => grouped.get(e.id) === g.id) });
    const loose = spec.entities.filter((e) => !grouped.has(e.id));
    if (loose.length) blocks.push({ id: null, items: loose });
    const maxRowWidth = num(layout.maxWidth, 1700);
    rects = new Map();
    let bx = MARGIN + GROUP_PAD; let by = MARGIN + GROUP_PAD + GROUP_LABEL_H; let rowH = 0;
    for (const block of blocks) {
      const blockCols = Math.min(block.items.length, cols ?? Math.ceil(Math.sqrt(block.items.length)));
      const inner = gridPlace(block.items, { cols: blockCols, gapX, gapY, originX: 0, originY: 0, sizeOf });
      const blockW = inner.width + GROUP_PAD * 2; const blockH = inner.height + GROUP_PAD * 2 + GROUP_LABEL_H;
      if (bx > MARGIN + GROUP_PAD && bx + blockW > maxRowWidth) { bx = MARGIN + GROUP_PAD; by += rowH + gapY; rowH = 0; }
      for (const r of inner.placed.values()) rects.set(r.id, { ...r, x: r.x + bx, y: r.y + by });
      bx += blockW + gapX + 120; rowH = Math.max(rowH, blockH);
    }
  }
  let body = '';
  const warnings = [];

  for (const g of groups) {
    const members = g.entities.map((id) => rects.get(id)).filter(Boolean);
    const box = bbox(members, GROUP_PAD - 6);
    if (!box) continue;
    box.y -= GROUP_LABEL_H - 6; box.h += GROUP_LABEL_H - 6;
    for (const e of spec.entities) {
      if (g.entities.includes(e.id)) continue;
      const r = rects.get(e.id);
      if (r && r.x < box.x + box.w && r.x + r.w > box.x && r.y < box.y + box.h && r.y + r.h > box.y) {
        warnings.push(`group "${g.id}" frame overlaps non-member entity "${e.id}"; give members explicit row/col so they sit together`);
      }
    }
    body += `<g class="group" data-group-id="${esc(g.id)}"><rect class="group-frame" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"/>`;
    body += svgText(box.x + 12, box.y + 16, g.label, { cls: 'group-label' });
    body += '</g>';
  }

  const rels = spec.relationships || [];
  const offsets = portOffsets(rels, rects, 18);
  const obstacles = [...rects.values()].map((r) => ({ x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 }));
  let labels = '';
  // Place the widest labels first so they get the roomy spots.
  const labelSize = (r) => ((r.label || '').length + Math.max((r.from_column || '').length + (r.to_column || '').length, 0));
  const order = rels.map((_, i) => i).sort((a, b) => labelSize(rels[b]) - labelSize(rels[a]));
  for (const i of order) { const r = renderRelationship(rels[i], i, rects, offsets[i], obstacles); body += r.edge; labels += r.labelSvg; }
  for (const e of spec.entities) body += renderEntity(e, rects.get(e.id));
  body += labels;

  const all = [...rects.values()];
  const extent = bbox(all, 0);
  const width = extent.x + extent.w + MARGIN + (hasGroups ? GROUP_PAD : 0) + 40;
  const height = extent.y + extent.h + MARGIN + (hasGroups ? GROUP_PAD : 0);
  const theme = spec.meta.theme === 'dark' ? 'dark' : 'light';
  const svg = wrapSvg({ body, width, height, title: spec.meta.title, theme, diagramType: 'erd' });

  const legend = [
    { label: 'primary key', className: 'text pk', glyph: 'PK' },
    { label: 'foreign key', className: 'text fk', glyph: 'FK' },
    { label: 'name? = nullable', className: 'text', glyph: '?' },
    { label: 'one', className: 'card-one', glyph: '' },
    { label: 'zero or one', className: 'card-zero-or-one', glyph: '' },
    { label: 'many (0..*)', className: 'card-many', glyph: '' },
    { label: 'one or many (1..*)', className: 'card-one-or-many', glyph: '' },
  ];
  return { svg, legend, width, height, warnings };
}
