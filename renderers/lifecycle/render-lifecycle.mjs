import { esc, svgText, nodeAttrs, edgeAttrs, truncate, textWidth, wrapText, fitChars, num, cellIndex } from '../shared/utils.mjs';
import { rowsPlace, bbox, routeOrthogonal, routeSelfLoop, pathFromPoints, placeLabel, portOffsets } from '../shared/layout.mjs';
import { wrapSvg } from '../shared/svgdoc.mjs';

const MARGIN = 40;
const BOX_W = 176;
const BOX_H = 60;
const START_R = 7;
const START_GAP = 34;

function descLines(state, w) {
  return wrapText(state.description || '', fitChars(w - 24, 11), 2);
}

function sizeOf(state) {
  const w = Math.max(BOX_W, Math.min(260, textWidth(state.label, 14) + 48));
  const lines = descLines(state, w).length;
  return { w, h: BOX_H + lines * 14 + (state.actor ? 4 : 0) };
}

// Rank states along the happy path: initial states first, then breadth-first
// over transitions. Failure and terminal states settle wherever they are reached.
function autoRanks(spec) {
  const ids = spec.states.map((s) => s.id);
  const out = new Map(ids.map((id) => [id, []]));
  const indegree = new Map(ids.map((id) => [id, 0]));
  for (const t of spec.transitions || []) {
    if (t.from === t.to || !out.has(t.from) || !out.has(t.to)) continue;
    out.get(t.from).push(t.to);
    indegree.set(t.to, indegree.get(t.to) + 1);
  }
  const initial = spec.states.filter((s) => s.kind === 'initial').map((s) => s.id);
  const roots = initial.length ? initial : ids.filter((id) => indegree.get(id) === 0);
  const queue = roots.length ? [...roots] : ids.slice(0, 1);
  // Shortest path from the start: state machines have cycles (resubmit,
  // re-approve), so longest-path ranking would churn. Shortest distance is
  // stable and matches how people narrate a lifecycle.
  const rank = new Map(queue.map((id) => [id, 0]));
  while (queue.length) {
    const id = queue.shift();
    for (const next of out.get(id)) if (!rank.has(next)) { rank.set(next, rank.get(id) + 1); queue.push(next); }
  }
  for (const id of ids) if (!rank.has(id)) rank.set(id, 0);
  // Terminal states sit after everything that can reach them, so "cancelled"
  // does not land in column 1 just because a draft can be cancelled.
  const preds = new Map(ids.map((id) => [id, []]));
  for (const t of spec.transitions || []) if (t.from !== t.to && preds.has(t.to) && preds.has(t.from)) preds.get(t.to).push(t.from);
  for (const s of spec.states) {
    if (s.kind !== 'terminal') continue;
    const before = preds.get(s.id).filter((p) => spec.states.find((x) => x.id === p)?.kind !== 'terminal');
    if (before.length) rank.set(s.id, Math.max(...before.map((p) => rank.get(p))) + 1);
  }
  for (const s of spec.states) if (cellIndex(s.row) !== undefined) rank.set(s.id, s.row);
  const rows = [];
  for (const s of spec.states) (rows[rank.get(s.id)] ||= []).push(s);
  const KIND_ORDER = { initial: 0, normal: 1, waiting: 2, undefined: 1, failure: 3, terminal: 4 };
  return rows.filter(Boolean).map((row) => row.sort((a, b) => {
    const ca = cellIndex(a.col); const cb = cellIndex(b.col);
    if (ca !== undefined && cb !== undefined) return ca - cb;
    if (ca !== undefined) return -1;
    if (cb !== undefined) return 1;
    return (KIND_ORDER[a.kind] ?? 1) - (KIND_ORDER[b.kind] ?? 1);
  }));
}

function renderState(state, rect, direction) {
  const { x, y, w, h } = rect;
  const kind = state.kind || 'normal';
  let out = `<g${nodeAttrs(state.id, state.label, { class: `node lc-state ${kind}`, kind })}>`;
  const tip = [state.label, `[${kind}]`, state.description || '', state.actor ? `next: ${state.actor}` : ''].filter(Boolean).join(' · ');
  out += `<title>${esc(tip)}</title>`;
  if (kind === 'initial') {
    // Start dot feeding the initial state.
    const sx = direction === 'lr' ? x - START_GAP : x + w / 2;
    const sy = direction === 'lr' ? y + h / 2 : y - START_GAP;
    out += `<circle class="start" cx="${sx}" cy="${sy}" r="${START_R}"/>`;
    out += direction === 'lr'
      ? `<path class="start-line" d="M${sx + START_R} ${sy} L${x} ${sy}" marker-end="url(#m-arrow)"/>`
      : `<path class="start-line" d="M${sx} ${sy + START_R} L${sx} ${y}" marker-end="url(#m-arrow)"/>`;
  }
  const rx = kind === 'terminal' ? h / 2 : 10;
  out += `<rect class="box" x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;
  if (kind === 'terminal') out += `<rect class="box-inner" x="${x + 4}" y="${y + 4}" width="${w - 8}" height="${h - 8}" rx="${(h - 8) / 2}"/>`;
  const lines = descLines(state, w);
  const cx = x + w / 2;
  const labelY = lines.length ? y + 24 : y + h / 2 + (state.actor ? -2 : 5);
  out += svgText(cx, labelY, truncate(state.label, fitChars(w - 28, 14)), { cls: 'title', anchor: 'middle' });
  lines.forEach((line, i) => { out += svgText(cx, y + 42 + i * 14, line, { cls: 'desc', anchor: 'middle' }); });
  if (state.actor) out += svgText(cx, y + h - 9, `next: ${truncate(state.actor, fitChars(w - 28, 10))}`, { cls: 'actor', anchor: 'middle' });
  out += '</g>';
  return out;
}

function transitionLines(t) {
  const first = t.label || t.event || '';
  const lines = [];
  if (first) lines.push({ text: truncate(t.actor ? `${t.actor}: ${first}` : first, 44), cls: 'label' });
  if (t.guard) lines.push({ text: truncate(`[${t.guard}]`, 44), cls: 'label tech' });
  if (t.action) lines.push({ text: truncate(`/ ${t.action}`, 44), cls: 'label tech' });
  return lines;
}

function renderTransition(t, index, rects, offset, obstacles) {
  const a = rects.get(t.from); const b = rects.get(t.to);
  if (!a || !b) return { edge: '', labelSvg: '' };
  const route = t.from === t.to ? routeSelfLoop(a, offset.from) : routeOrthogonal(a, b, offset);
  const d = pathFromPoints(route.points, 10);
  const kind = t.kind || 'normal';
  const cls = `edge lc-transition ${kind}${kind === 'auto' || kind === 'timeout' ? ' dashed' : ''}`;
  const base = edgeAttrs({ ...t, label: t.label || t.event }, index);
  const tip = [t.actor, t.event, t.guard ? `[${t.guard}]` : '', t.action ? `/ ${t.action}` : ''].filter(Boolean).join(' ') || `${t.from} → ${t.to}`;
  let edge = `<g${base.replace('class="edge"', `class="${cls}"`)}><title>${esc(tip)}</title>`;
  edge += `<path class="hit" d="${d}"/>`;
  edge += `<path class="line" d="${d}" marker-end="url(#${kind === 'failure' ? 'm-arrow-failure' : 'm-arrow'})"/>`;
  edge += '</g>';
  const lines = transitionLines(t);
  let labelSvg = '';
  if (lines.length) {
    const widest = Math.max(...lines.map((l) => textWidth(l.text, l.cls.includes('tech') ? 10.5 : 11.5)));
    const lw = widest + 12; const lh = lines.length * 13 + 6;
    const box = placeLabel(route.points, lw, lh, obstacles);
    obstacles.push({ ...box, label: true });
    labelSvg = `<g${base.replace('class="edge"', `class="edge-label ${kind}"`).replace(/ id="[^"]*"/, '').replace(/ tabindex="0"/, '').replace(/ role="button"/, '')}><title>${esc(tip)}</title>`;
    labelSvg += `<rect class="label-bg" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"/>`;
    lines.forEach((l, i) => { labelSvg += svgText(box.x + box.w / 2, box.y + 13 * (i + 1) - 1, l.text, { cls: l.cls, anchor: 'middle' }); });
    labelSvg += '</g>';
  }
  return { edge, labelSvg };
}

export function renderLifecycle(spec) {
  const layout = spec.layout || {};
  const direction = layout.direction === 'tb' ? 'tb' : 'lr';
  const rows = autoRanks(spec);
  const placement = rowsPlace(rows, {
    direction,
    gapX: num(layout.gapX, direction === 'lr' ? 130 : 80),
    gapY: num(layout.gapY, direction === 'lr' ? 56 : 110),
    originX: MARGIN + (direction === 'lr' ? START_GAP + START_R : 0),
    originY: MARGIN + (direction === 'tb' ? START_GAP + START_R : 0),
    sizeOf,
  });
  const rects = placement.placed;
  const transitions = spec.transitions || [];
  const offsets = portOffsets(transitions, rects, 20);
  const obstacles = [...rects.values()].map((r) => ({ x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 }));
  let body = '';
  let labels = '';
  const size = (t) => (t.label || t.event || '').length + (t.guard || '').length + (t.action || '').length;
  const order = transitions.map((_, i) => i).sort((a, b) => size(transitions[b]) - size(transitions[a]));
  for (const i of order) { const r = renderTransition(transitions[i], i, rects, offsets[i], obstacles); body += r.edge; labels += r.labelSvg; }
  for (const s of spec.states) body += renderState(s, rects.get(s.id), direction);
  body += labels;

  const extent = bbox([...rects.values()], 0);
  const width = extent.x + extent.w + MARGIN + 60;
  const height = extent.y + extent.h + MARGIN + 20;
  const theme = spec.meta.theme === 'dark' ? 'dark' : 'light';
  const svg = wrapSvg({ body, width, height, title: spec.meta.title, theme, diagramType: 'lifecycle' });
  const kinds = new Set(spec.states.map((s) => s.kind || 'normal'));
  const legend = [
    { key: 'initial', label: 'Initial state (● start)', style: 'background:var(--surface);border:2px solid var(--accent)' },
    { key: 'normal', label: 'State', style: 'background:var(--surface);border:1.5px solid var(--border)' },
    { key: 'waiting', label: 'Waiting on external event', style: 'background:var(--lc-waiting-bg);border:1.5px dashed var(--lc-waiting)' },
    { key: 'terminal', label: 'Terminal (double border)', style: 'background:var(--lc-terminal-bg);border:3px double var(--lc-terminal);border-radius:999px' },
    { key: 'failure', label: 'Failure / rejected', style: 'background:var(--lc-failure-bg);border:1.5px solid var(--lc-failure)' },
  ].filter((l) => kinds.has(l.key));
  if (transitions.some((t) => t.kind === 'auto' || t.kind === 'timeout')) legend.push({ label: 'Dashed = system / timeout', className: 'text', glyph: '⇢' });
  if (transitions.some((t) => t.kind === 'failure')) legend.push({ label: 'Red = failure path', className: 'text', glyph: '→', style: 'color:var(--lc-failure)' });
  legend.push({ label: 'actor: event [guard] / action', className: 'text', glyph: '' });
  return { svg, legend, width, height, warnings: [] };
}
