import { esc, svgText, nodeAttrs, edgeAttrs, truncate, textWidth, wrapText, fitChars, num, cellIndex } from '../shared/utils.mjs';
import { rowsPlace, orderRanks, bbox, routeOrthogonal, routeSelfLoop, pathFromPoints, placeLabel, portOffsets, channelOffsets, detour, routeHits, pinPositions } from '../shared/layout.mjs';
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
  const sorted = rows.filter(Boolean).map((row) => row.sort((a, b) => {
    const ca = cellIndex(a.col); const cb = cellIndex(b.col);
    if (ca !== undefined && cb !== undefined) return ca - cb;
    if (ca !== undefined) return -1;
    if (cb !== undefined) return 1;
    return (KIND_ORDER[a.kind] ?? 1) - (KIND_ORDER[b.kind] ?? 1);
  }));
  const edges = (spec.transitions || []).map((t) => [t.from, t.to]);
  return orderRanks(sorted, edges, { fixed: (row) => row.some((s) => cellIndex(s.col) !== undefined) });
}

function renderState(state, rect, direction) {
  const { x, y, w, h } = rect;
  const kind = state.kind || 'normal';
  let out = `<g${nodeAttrs(state.id, state.label, { class: `node lc-state ${kind}`, kind, at: rect })}>`;
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
  out += `<rect class="box" filter="url(#m-shadow)" x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;
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

const LABEL_CHARS = 38;

function transitionLines(t) {
  const first = t.label || t.event || '';
  const lines = [];
  if (first) lines.push({ text: truncate(t.actor ? `${t.actor}: ${first}` : first, LABEL_CHARS), cls: 'label' });
  if (t.guard) lines.push({ text: truncate(`[${t.guard}]`, LABEL_CHARS), cls: 'label tech' });
  if (t.action) lines.push({ text: truncate(`/ ${t.action}`, LABEL_CHARS), cls: 'label tech' });
  return lines;
}

function labelSize(lines) {
  const widest = Math.max(0, ...lines.map((l) => textWidth(l.text, l.cls.includes('tech') ? 10.5 : 11.5)));
  return { w: widest + 12, h: lines.length * 13 + 6 };
}

// Transition labels live in the gap between ranks. A fixed gap that is narrower
// than the widest label does not make the label smaller — it puts it on top of
// a state. So the gap is measured from the labels that have to fit in it.
function gapsFor(transitions) {
  let w = 0; let h = 0;
  for (const t of transitions) {
    const lines = transitionLines(t);
    if (!lines.length) continue;
    const size = labelSize(lines);
    w = Math.max(w, size.w); h = Math.max(h, size.h);
  }
  return { w, h };
}

const flip = (r) => ({ ...r, x: r.y, y: r.x, w: r.h, h: r.w });
const BACK_GAP = 22;
const BACK_LANE = 14;

function isBack(a, b, direction) {
  return direction === 'tb' ? b.y + b.h + 24 <= a.y : b.x + b.w + 24 <= a.x;
}

// A transition that runs against the flow (retry, send back, appeal upheld)
// drawn like a forward one lands on the same side forward edges leave from,
// and every box with a loop becomes a knot. Back edges go over or under
// instead, each in its own lane. Worked in lr; tb is the same with x/y swapped.
function loopPoints(a, b, side, y, ao = 0, bo = 0) {
  const ax = a.x + a.w / 2 + ao; const bx = b.x + b.w / 2 + bo;
  const ay = side === 'top' ? a.y : a.y + a.h; const by = side === 'top' ? b.y : b.y + b.h;
  return [[ax, ay], [ax, y], [bx, y], [bx, by]];
}

function backRoutes(transitions, rects, direction, avoid = []) {
  const T = direction === 'tb' ? flip : (r) => r;
  const boxes = [...rects.entries()].map(([id, r]) => ({ id, ...T(r) }));
  const mid = boxes.reduce((s, r) => s + r.y + r.h / 2, 0) / Math.max(1, boxes.length);
  const back = [];
  transitions.forEach((t, i) => {
    const a = rects.get(t.from); const b = rects.get(t.to);
    if (!a || !b || t.from === t.to || !isBack(a, b, direction)) return;
    const e = { i, a: T(a), b: T(b) };
    const others = boxes.filter((r) => r.id !== t.from && r.id !== t.to);
    const hits = (side) => routeHits(loopPoints(e.a, e.b, side, side === 'top' ? Math.min(e.a.y, e.b.y) - BACK_GAP : Math.max(e.a.y + e.a.h, e.b.y + e.b.h) + BACK_GAP), others).length;
    const preferred = (e.a.y + e.a.h / 2 + e.b.y + e.b.h / 2) / 2 <= mid ? 'top' : 'bottom';
    const other = preferred === 'top' ? 'bottom' : 'top';
    // A leg that climbs through a box in its own column is worse than the knot
    // this avoids, so such a transition keeps the ordinary route.
    e.side = !hits(preferred) ? preferred : !hits(other) ? other : null;
    if (e.side) back.push(e);
  });
  // Short loops take the inner lanes so long ones wrap around them, not through.
  back.sort((p, q) => (p.a.x - p.b.x) - (q.a.x - q.b.x) || p.i - q.i);
  // Forward routes are already drawn, so a lane that lands on one of their
  // horizontal runs reads as the same line.
  const used = [];
  for (const pts of avoid) {
    const tp = direction === 'tb' ? pts.map(([x, y]) => [y, x]) : pts;
    for (let k = 1; k < tp.length; k += 1) {
      const [p, q] = [tp[k - 1], tp[k]];
      if (p[1] === q[1]) used.push({ lo: Math.min(p[0], q[0]), hi: Math.max(p[0], q[0]), y: p[1] });
    }
  }
  const ends = new Map();
  for (const e of back) {
    for (const [id, end, other] of [[transitions[e.i].from, 'ao', e.b], [transitions[e.i].to, 'bo', e.a]]) {
      const k = `${id}|${e.side}`;
      (ends.get(k) || ends.set(k, []).get(k)).push({ e, end, w: (end === 'ao' ? e.a : e.b).w, ox: other.x });
    }
  }
  for (const list of ends.values()) {
    list.sort((p, q) => p.ox - q.ox);
    const step = Math.min(18, (list[0].w * 0.6) / Math.max(1, list.length - 1));
    list.forEach((p, k) => { p.e[p.end] = (k - (list.length - 1) / 2) * step; });
  }
  const out = new Map();
  for (const e of back) {
    const { a, b, side } = e;
    const lo = b.x; const hi = a.x + a.w;
    const top = side === 'top';
    let y = top ? Math.min(a.y, b.y) - BACK_GAP : Math.max(a.y + a.h, b.y + b.h) + BACK_GAP;
    while (used.some((u) => u.lo < hi && lo < u.hi && Math.abs(u.y - y) < BACK_LANE)) y += top ? -BACK_LANE : BACK_LANE;
    used.push({ lo, hi, y });
    let points = loopPoints(a, b, side, y, e.ao, e.bo);
    if (direction === 'tb') points = points.map(([x, yy]) => [yy, x]);
    out.set(e.i, points);
  }
  return out;
}

function routeFor(t, rects, offset, backPoints) {
  const a = rects.get(t.from); const b = rects.get(t.to);
  if (!a || !b) return null;
  if (t.from === t.to) return routeSelfLoop(a, offset.from).points;
  const points = backPoints || routeOrthogonal(a, b, offset).points;
  return detour(points, [...rects.entries()].filter(([id]) => id !== t.from && id !== t.to).map(([, r]) => r));
}

function renderTransition(t, index, points, obstacles) {
  if (!points) return { edge: '', labelSvg: '' };
  const route = { points };
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
    const { w: lw, h: lh } = labelSize(lines);
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
  const label = gapsFor(spec.transitions || []);
  const placement = rowsPlace(rows, {
    direction,
    gapX: num(layout.gapX, Math.max(direction === 'lr' ? 130 : 80, label.w + 30)),
    gapY: num(layout.gapY, Math.max(direction === 'lr' ? 56 : 110, label.h + 22)),
    originX: MARGIN + (direction === 'lr' ? START_GAP + START_R : 0),
    originY: MARGIN + (direction === 'tb' ? START_GAP + START_R : 0),
    sizeOf,
  });
  const rects = placement.placed;
  const warnings = pinPositions(rects, layout.positions);
  const transitions = spec.transitions || [];
  const isBackEdge = backRoutes(transitions, rects, direction);
  const forward = transitions.map((_, i) => i).filter((i) => !isBackEdge.has(i));
  const offsets = transitions.map(() => ({ from: 0, to: 0 }));
  const fwdOffsets = portOffsets(forward.map((i) => transitions[i]), rects, 20);
  // Transitions crossing the same gap otherwise all turn at its midpoint, which
  // stacks their labels into one column. Same lane assignment as C4 and ERD.
  const channels = channelOffsets(forward.map((i) => transitions[i]), rects, fwdOffsets);
  forward.forEach((i, k) => { offsets[i] = { ...fwdOffsets[k], channel: channels[k] }; });
  const points = transitions.map((t, i) => (isBackEdge.has(i) ? null : routeFor(t, rects, offsets[i])));
  const back = backRoutes(transitions, rects, direction, points.filter(Boolean));
  for (const [i, pts] of back) points[i] = routeFor(transitions[i], rects, offsets[i], pts);
  const obstacles = [...rects.values()].map((r) => ({ x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 }));
  let body = '';
  let labels = '';
  const size = (t) => (t.label || t.event || '').length + (t.guard || '').length + (t.action || '').length;
  const order = transitions.map((_, i) => i).sort((a, b) => size(transitions[b]) - size(transitions[a]));
  for (const i of order) { const r = renderTransition(transitions[i], i, points[i], obstacles); body += r.edge; labels += r.labelSvg; }
  for (const s of spec.states) body += renderState(s, rects.get(s.id), direction);
  body += labels;

  const extent = bbox([...rects.values(), ...points.filter(Boolean).flat().map(([x, y]) => ({ x, y, w: 0, h: 0 }))], 0);
  const width = extent.x + extent.w + MARGIN + 60;
  const height = extent.y + extent.h + MARGIN + 20;
  const theme = spec.meta.theme === 'dark' ? 'dark' : 'light';
  const svg = wrapSvg({ body, width, height, title: spec.meta.title, theme, diagramType: 'lifecycle', proposed: spec.meta.proposed === true });
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
  return { svg, legend, width, height, warnings };
}
