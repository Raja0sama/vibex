import { esc, svgText, nodeAttrs, truncate, textWidth, fitChars, num } from '../shared/utils.mjs';
import { wrapSvg } from '../shared/svgdoc.mjs';

const MARGIN = 40;
const GAP = 28;
const HEAD_H = 42;
const ROW_H = 30;
const ROW_H_SUMMARY = 44;
const FOOT = 8;
const TYPE_ROW_H = 18;
const TYPE_HEAD_H = 34;

const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'QUERY', 'MUTATION', 'SUBSCRIPTION', 'EVENT'];

function chip(x, y, text) {
  const w = textWidth(text, 8.5, true) + 10;
  return { w, svg: `<rect class="chip" x="${x - w}" y="${y}" width="${w}" height="16"/>${svgText(x - w / 2, y + 11.5, text, { cls: 'chip-text', anchor: 'middle' })}` };
}

function renderEndpointRow(ep, x, y, w, rowH) {
  const method = ep.method;
  const badgeW = Math.max(44, textWidth(method, 9.5, true) + 12);
  const cls = `node ep-row${ep.deprecated ? ' deprecated' : ''}`;
  let out = `<g${nodeAttrs(ep.id, `${method} ${ep.path}`, { class: cls, kind: 'endpoint' })} data-method="${esc(method)}">`;
  const tip = [`${method} ${ep.path}`, ep.summary || '', ep.auth ? `auth: ${ep.auth}` : '', ep.response ? `→ ${ep.response}` : ''].filter(Boolean).join(' · ');
  out += `<title>${esc(tip)}</title>`;
  out += `<rect x="${x}" y="${y}" width="${w}" height="${rowH}" style="fill:transparent"/>`;
  out += `<g class="method ${esc(method)}"><rect x="${x + 10}" y="${y + 7}" width="${badgeW}" height="16"/>${svgText(x + 10 + badgeW / 2, y + 18.5, method, { anchor: 'middle' })}</g>`;
  // Right-side chips, laid right-to-left.
  let cx = x + w - 10;
  const chips = [];
  if (ep.deprecated) chips.push('deprecated');
  const status = Array.isArray(ep.status) ? ep.status.filter((c) => Number.isInteger(c) || typeof c === 'string') : [];
  if (status.length) chips.push(status.slice(0, 4).join(' '));
  if (ep.auth && ep.auth !== 'none') chips.push(`🔒 ${truncate(ep.auth, 14)}`);
  let chipsSvg = '';
  for (const text of chips) {
    const c = chip(cx, y + 7, text);
    chipsSvg += c.svg;
    cx -= c.w + 6;
  }
  const pathX = x + 10 + badgeW + 8;
  const pathMax = fitChars(cx - pathX - 6, 11, true);
  out += svgText(pathX, y + 19, truncate(ep.path, pathMax), { cls: 'path' });
  out += chipsSvg;
  if (rowH === ROW_H_SUMMARY && ep.summary) {
    out += svgText(pathX, y + 34, truncate(ep.summary, fitChars(w - (pathX - x) - 12, 9.5)), { cls: 'summary' });
  }
  out += `<line class="sep" x1="${x + 1}" y1="${y + rowH}" x2="${x + w - 1}" y2="${y + rowH}"/>`;
  out += '</g>';
  return out;
}

function groupCardHeight(endpoints, withSummary) {
  return HEAD_H + endpoints.reduce((sum, ep) => sum + ((withSummary && ep.summary) ? ROW_H_SUMMARY : ROW_H), 0) + FOOT;
}

function renderGroupCard(group, endpoints, x, y, w, withSummary) {
  const h = groupCardHeight(endpoints, withSummary);
  let out = `<g class="ep-card" data-group-id="${esc(group.id)}" data-node-id="${esc(group.id)}" data-node-label="${esc(group.label)}" data-node-kind="group">`;
  out += `<rect class="box" filter="url(#m-shadow)" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
  out += `<path class="head" d="M${x} ${y + 8} a8 8 0 0 1 8 -8 h${w - 16} a8 8 0 0 1 8 8 v${HEAD_H - 8} h${-w} z"/>`;
  out += `<line x1="${x}" y1="${y + HEAD_H}" x2="${x + w}" y2="${y + HEAD_H}" style="stroke:var(--border)"/>`;
  const countText = `${endpoints.length} endpoint${endpoints.length === 1 ? '' : 's'}`;
  out += svgText(x + 12, y + 26, truncate(group.label, fitChars(w - 24 - textWidth(countText, 10), 13)), { cls: 'title' });
  out += svgText(x + w - 12, y + 26, countText, { cls: 'count', anchor: 'end' });
  out += '</g>';
  let ry = y + HEAD_H;
  for (const ep of endpoints) {
    const rowH = (withSummary && ep.summary) ? ROW_H_SUMMARY : ROW_H;
    out += renderEndpointRow(ep, x, ry, w, rowH);
    ry += rowH;
  }
  return { svg: out, h };
}

function typeCardHeight(type) {
  const rows = type.kind === 'enum' ? (type.values || []).length : (type.fields || []).length;
  return TYPE_HEAD_H + Math.max(1, rows) * TYPE_ROW_H + 6;
}

function renderTypeCard(type, x, y, w) {
  const h = typeCardHeight(type);
  let out = `<g${nodeAttrs(type.id, type.name, { class: 'node type-card', kind: `type-${type.kind || 'object'}` })}>`;
  out += `<title>${esc(type.name)}${type.description ? ` — ${esc(type.description)}` : ''}</title>`;
  out += `<rect class="box" filter="url(#m-shadow)" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
  out += `<path class="head" d="M${x} ${y + 8} a8 8 0 0 1 8 -8 h${w - 16} a8 8 0 0 1 8 8 v${TYPE_HEAD_H - 8} h${-w} z"/>`;
  out += `<line x1="${x}" y1="${y + TYPE_HEAD_H}" x2="${x + w}" y2="${y + TYPE_HEAD_H}" style="stroke:var(--border)"/>`;
  out += svgText(x + 10, y + 22, truncate(type.name, fitChars(w - 80, 13)), { cls: 'title' });
  out += svgText(x + w - 10, y + 22, type.kind || 'object', { cls: 'sub', anchor: 'end' });
  let ry = y + TYPE_HEAD_H;
  const rows = type.kind === 'enum' ? (type.values || []).map((v) => ({ name: v })) : (type.fields || []);
  if (!rows.length) out += svgText(x + 10, ry + 13, '(no fields)', { cls: 'row-type' });
  for (const f of rows) {
    const typeText = f.type ? `${f.type}${f.required ? '!' : ''}` : '';
    const typeW = textWidth(typeText, 10, true);
    out += `<g class="row"><title>${esc([f.name, typeText, f.description || ''].filter(Boolean).join(' · '))}</title>`;
    out += svgText(x + 10, ry + 13, truncate(f.name, fitChars(w - 20 - typeW - 10, 11, true)), { cls: 'row-text' });
    if (typeText) out += svgText(x + w - 10, ry + 13, typeText, { cls: 'row-type', anchor: 'end' });
    out += '</g>';
    ry += TYPE_ROW_H;
  }
  out += '</g>';
  return { svg: out, h };
}

function masonry(items, heightOf, columns, cardW, x0, y0) {
  const colY = new Array(columns).fill(y0);
  const placed = [];
  for (const item of items) {
    let col = 0;
    for (let c = 1; c < columns; c += 1) if (colY[c] < colY[col] - 1) col = c;
    const x = x0 + col * (cardW + GAP);
    const y = colY[col];
    const h = heightOf(item);
    placed.push({ item, x, y, h });
    colY[col] = y + h + GAP;
  }
  return { placed, bottom: Math.max(...colY) - GAP };
}

export function renderEndpoints(spec) {
  const layout = spec.layout && typeof spec.layout === 'object' ? spec.layout : {};
  const cardW = num(layout.card_width, 480, { min: 200, max: 2000 });
  const groups = [...(spec.groups || [])];
  const groupIds = new Set(groups.map((g) => g.id));
  // Endpoints without a (known) group share a synthetic "Other" card. Its id
  // must not collide with anything the author declared, and it is handed back
  // so the embedded spec has an entry for the details panel.
  const takenIds = new Set([...groupIds, ...spec.endpoints.map((e) => e.id), ...(spec.types || []).map((t) => t.id)]);
  let defaultId = 'default'; let n = 2;
  while (takenIds.has(defaultId)) { defaultId = `default-${n}`; n += 1; }
  const byGroup = new Map(groups.map((g) => [g.id, []]));
  const syntheticGroups = [];
  for (const ep of spec.endpoints) {
    const gid = ep.group && groupIds.has(ep.group) ? ep.group : defaultId;
    if (gid === defaultId && !byGroup.has(defaultId)) {
      byGroup.set(defaultId, []);
      const other = { id: defaultId, label: 'Other', description: 'Endpoints without a group', synthetic: true };
      groups.push(other); syntheticGroups.push(other);
    }
    byGroup.get(gid).push(ep);
  }
  for (const list of byGroup.values()) {
    list.sort((a, b) => (a.path === b.path ? METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method) : 0));
  }
  const nonEmpty = groups.filter((g) => (byGroup.get(g.id) || []).length);
  const autoColumns = nonEmpty.length <= 1 ? 1 : nonEmpty.length <= 4 ? 2 : 3;
  // Never more columns than cards: empty columns only widen the canvas.
  const columns = Math.min(Math.max(1, nonEmpty.length), num(layout.columns, autoColumns, { min: 1, max: 12, integer: true }));
  const withSummary = spec.endpoints.some((e) => e.summary);

  let body = '';
  let y = MARGIN;
  const subtitleBits = [spec.meta.api_kind ? spec.meta.api_kind.toUpperCase() : '', spec.meta.base_url || '', spec.meta.version ? `v${spec.meta.version}` : ''].filter(Boolean);
  if (subtitleBits.length) { body += svgText(MARGIN, y + 4, subtitleBits.join('  ·  '), { cls: 'watermark', mono: true }); y += 16; }

  const groupLayout = masonry(nonEmpty, (g) => groupCardHeight(byGroup.get(g.id), withSummary), columns, cardW, MARGIN, y);
  for (const p of groupLayout.placed) body += renderGroupCard(p.item, byGroup.get(p.item.id), p.x, p.y, cardW, withSummary).svg;
  y = groupLayout.bottom;

  const types = spec.types || [];
  if (types.length && layout.show_types !== false) {
    y += 56;
    body += svgText(MARGIN, y - 18, `Types (${types.length})`, { cls: 'section-title' });
    const typeCols = Math.max(columns, Math.min(4, Math.ceil(types.length / 3)));
    const typeW = Math.floor((columns * cardW + (columns - 1) * GAP - (typeCols - 1) * GAP) / typeCols);
    const typeLayout = masonry(types, typeCardHeight, typeCols, typeW, MARGIN, y);
    for (const p of typeLayout.placed) body += renderTypeCard(p.item, p.x, p.y, typeW).svg;
    y = typeLayout.bottom;
  }

  const width = MARGIN * 2 + columns * cardW + (columns - 1) * GAP;
  const height = y + MARGIN;
  const theme = spec.meta.theme === 'dark' ? 'dark' : 'light';
  const svg = wrapSvg({ body, width, height, title: spec.meta.title, theme, diagramType: 'endpoints', proposed: spec.meta.proposed === true });
  const present = new Set(spec.endpoints.map((e) => e.method));
  const legend = METHOD_ORDER.filter((m) => present.has(m)).map((m) => ({ label: m, style: `background:var(--${m === 'HEAD' || m === 'OPTIONS' ? 'other' : m.toLowerCase()})` }));
  if (spec.endpoints.some((e) => e.auth && e.auth !== 'none')) legend.push({ label: '🔒 auth required', className: 'text' });
  if (spec.endpoints.some((e) => e.deprecated)) legend.push({ label: 'struck = deprecated', className: 'text' });
  return { svg, legend, width, height, warnings: [], syntheticGroups };
}
