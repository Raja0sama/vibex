// Grid placement and orthogonal edge routing. Deliberately simple:
// the agent orders items, the renderer places them. No force layout.
import { cellIndex } from './utils.mjs';

export function gridPlace(items, { cols, gapX = 80, gapY = 70, originX = 0, originY = 0, sizeOf }) {
  const n = items.length;
  const autoCols = (Number.isInteger(cols) && cols >= 1) ? cols : Math.max(1, Math.ceil(Math.sqrt(n)));
  const placedCells = new Set();
  const cells = new Map();
  let cursor = 0;

  // Honor explicit row/col first so auto items flow around them. Out-of-range
  // values are treated as unset; a cell claimed twice falls through to auto
  // placement so two items never stack on one spot.
  for (const item of items) {
    const row = cellIndex(item.row); const col = cellIndex(item.col);
    if (row === undefined || col === undefined || placedCells.has(`${row}:${col}`)) continue;
    cells.set(item.id, { row, col });
    placedCells.add(`${row}:${col}`);
  }
  for (const item of items) {
    if (cells.has(item.id)) continue;
    let row; let col;
    do {
      row = Math.floor(cursor / autoCols);
      col = cursor % autoCols;
      cursor += 1;
    } while (placedCells.has(`${row}:${col}`));
    cells.set(item.id, { row, col });
    placedCells.add(`${row}:${col}`);
  }

  const colWidths = [];
  const rowHeights = [];
  const sizes = new Map();
  for (const item of items) {
    const size = sizeOf(item);
    sizes.set(item.id, size);
    const { row, col } = cells.get(item.id);
    colWidths[col] = Math.max(colWidths[col] || 0, size.w);
    rowHeights[row] = Math.max(rowHeights[row] || 0, size.h);
  }
  const colX = [];
  let x = originX;
  for (let c = 0; c < colWidths.length; c += 1) {
    colX[c] = x;
    x += (colWidths[c] || 0) + gapX;
  }
  const rowY = [];
  let y = originY;
  for (let r = 0; r < rowHeights.length; r += 1) {
    rowY[r] = y;
    y += (rowHeights[r] || 0) + gapY;
  }

  const placed = new Map();
  for (const item of items) {
    const { row, col } = cells.get(item.id);
    const size = sizes.get(item.id);
    // Center inside the cell horizontally, top-align vertically.
    const cx = colX[col] + ((colWidths[col] - size.w) / 2);
    placed.set(item.id, { id: item.id, x: cx, y: rowY[row], w: size.w, h: size.h, row, col });
  }
  return {
    placed,
    width: Math.max(0, x - gapX - originX),
    height: Math.max(0, y - gapY - originY),
  };
}

export function rowsPlace(rows, { gapX = 80, gapY = 90, originX = 0, originY = 0, sizeOf, align = 'center', direction = 'tb' }) {
  // rows: array of arrays of items (one array per rank). direction 'tb' draws
  // ranks as rows top-to-bottom; 'lr' draws ranks as columns left-to-right.
  const sized = rows.map((row) => row.map((item) => ({ item, size: sizeOf(item) })));
  if (direction === 'lr') {
    const colHeights = sized.map((col) => col.reduce((sum, e, i) => sum + e.size.h + (i ? gapY : 0), 0));
    const totalHeight = Math.max(0, ...colHeights);
    const placed = new Map();
    let x = originX;
    sized.forEach((col, c) => {
      const colWidth = Math.max(0, ...col.map((e) => e.size.w));
      let y = originY + (align === 'left' ? 0 : (totalHeight - colHeights[c]) / 2);
      col.forEach((e, r) => {
        placed.set(e.item.id, { id: e.item.id, x: x + ((colWidth - e.size.w) / 2), y, w: e.size.w, h: e.size.h, row: r, col: c });
        y += e.size.h + gapY;
      });
      x += colWidth + gapX;
    });
    return { placed, width: Math.max(0, x - gapX - originX), height: totalHeight };
  }
  const rowWidths = sized.map((row) => row.reduce((sum, e, i) => sum + e.size.w + (i ? gapX : 0), 0));
  const totalWidth = Math.max(0, ...rowWidths);
  const placed = new Map();
  let y = originY;
  sized.forEach((row, r) => {
    const rowHeight = Math.max(0, ...row.map((e) => e.size.h));
    let x = originX + (align === 'left' ? 0 : (totalWidth - rowWidths[r]) / 2);
    row.forEach((e, c) => {
      placed.set(e.item.id, { id: e.item.id, x, y: y + ((rowHeight - e.size.h) / 2), w: e.size.w, h: e.size.h, row: r, col: c });
      x += e.size.w + gapX;
    });
    y += rowHeight + gapY;
  });
  return { placed, width: totalWidth, height: Math.max(0, y - gapY - originY) };
}

export function bbox(rects, pad = 0) {
  if (!rects.length) return null;
  const minX = Math.min(...rects.map((r) => r.x)) - pad;
  const minY = Math.min(...rects.map((r) => r.y)) - pad;
  const maxX = Math.max(...rects.map((r) => r.x + r.w)) + pad;
  const maxY = Math.max(...rects.map((r) => r.y + r.h)) + pad;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function rectContains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

// Route from rect a to rect b with an orthogonal path.
// `offset` shifts the anchor along the chosen side so parallel edges do not overlap.
export function routeOrthogonal(a, b, offset = 0) {
  const fo = typeof offset === 'object' ? offset.from : offset;
  const to_ = typeof offset === 'object' ? offset.to : offset;
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const gap = 24;
  let points;
  let fromSide; let toSide;
  if (b.x >= a.x + a.w + gap) {
    fromSide = 'right'; toSide = 'left';
    const ay = ac.y + fo; const by = bc.y + to_;
    const midX = (a.x + a.w + b.x) / 2;
    points = [[a.x + a.w, ay], [midX, ay], [midX, by], [b.x, by]];
  } else if (a.x >= b.x + b.w + gap) {
    fromSide = 'left'; toSide = 'right';
    const ay = ac.y + fo; const by = bc.y + to_;
    const midX = (b.x + b.w + a.x) / 2;
    points = [[a.x, ay], [midX, ay], [midX, by], [b.x + b.w, by]];
  } else if (b.y >= a.y + a.h) {
    fromSide = 'bottom'; toSide = 'top';
    const ax = ac.x + fo; const bx = bc.x + to_;
    const midY = (a.y + a.h + b.y) / 2;
    points = [[ax, a.y + a.h], [ax, midY], [bx, midY], [bx, b.y]];
  } else if (a.y >= b.y + b.h) {
    fromSide = 'top'; toSide = 'bottom';
    const ax = ac.x + fo; const bx = bc.x + to_;
    const midY = (b.y + b.h + a.y) / 2;
    points = [[ax, a.y], [ax, midY], [bx, midY], [bx, b.y + b.h]];
  } else {
    // Overlapping rects: draw a straight line between centers.
    fromSide = 'center'; toSide = 'center';
    points = [[ac.x, ac.y], [bc.x, bc.y]];
  }
  return { points: dedupe(points), fromSide, toSide };
}

// Self-referencing edge: small loop on the right side of the rect.
export function routeSelfLoop(a, offset = 0) {
  const y1 = a.y + a.h * 0.35 + offset;
  const y2 = a.y + a.h * 0.65 + offset;
  const x = a.x + a.w;
  const out = x + 36;
  return { points: [[x, y1], [out, y1], [out, y2], [x, y2]], fromSide: 'right', toSide: 'right' };
}

function dedupe(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  // Remove collinear middle points.
  const cleaned = [out[0]];
  for (let i = 1; i < out.length - 1; i += 1) {
    const prev = cleaned[cleaned.length - 1]; const cur = out[i]; const next = out[i + 1];
    const collinear = (prev[0] === cur[0] && cur[0] === next[0]) || (prev[1] === cur[1] && cur[1] === next[1]);
    if (!collinear) cleaned.push(cur);
  }
  if (out.length > 1) cleaned.push(out[out.length - 1]);
  return cleaned;
}

// Polyline → SVG path with rounded corners. Works segment by segment: every
// segment is drawn shorter at each end by the corner radius that belongs to
// that end, and a quadratic curve through the corner point joins neighbours.
// Zero-length segments are skipped so the direction vector never divides by 0.
function segmentsOf(points) {
  const segs = [];
  for (let i = 1; i < points.length; i += 1) {
    const start = points[i - 1]; const end = points[i];
    const len = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (len > 0) segs.push({ start, end, len, dir: [(end[0] - start[0]) / len, (end[1] - start[1]) / len] });
  }
  return segs;
}
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));
const along = (seg, dist, fromEnd = false) => (fromEnd
  ? [seg.end[0] - seg.dir[0] * dist, seg.end[1] - seg.dir[1] * dist]
  : [seg.start[0] + seg.dir[0] * dist, seg.start[1] + seg.dir[1] * dist]);

export function pathFromPoints(points, radius = 8) {
  const segs = segmentsOf(points);
  if (!segs.length) return points.length ? `M ${fmt(points[0][0])} ${fmt(points[0][1])}` : '';
  // Radius at the joint after segment k, clamped so it never eats more than half a segment.
  const cornerR = segs.slice(0, -1).map((seg, k) => (radius > 0 ? Math.min(radius, seg.len / 2, segs[k + 1].len / 2) : 0));
  const parts = [`M ${fmt(segs[0].start[0])} ${fmt(segs[0].start[1])}`];
  segs.forEach((seg, k) => {
    const trimEnd = k < cornerR.length ? cornerR[k] : 0;
    const lineEnd = trimEnd ? along(seg, trimEnd, true) : seg.end;
    parts.push(`L ${fmt(lineEnd[0])} ${fmt(lineEnd[1])}`);
    if (trimEnd) {
      const curveEnd = along(segs[k + 1], trimEnd);
      parts.push(`Q ${fmt(seg.end[0])} ${fmt(seg.end[1])} ${fmt(curveEnd[0])} ${fmt(curveEnd[1])}`);
    }
  });
  return parts.join(' ');
}

export function midpoint(points) {
  // Midpoint along the polyline by length.
  let total = 0;
  const segs = [];
  for (let i = 1; i < points.length; i += 1) {
    const len = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    segs.push(len); total += len;
  }
  let target = total / 2;
  for (let i = 0; i < segs.length; i += 1) {
    if (target <= segs[i]) {
      const t = segs[i] ? target / segs[i] : 0;
      const [x1, y1] = points[i]; const [x2, y2] = points[i + 1];
      return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t, horizontal: y1 === y2 };
    }
    target -= segs[i];
  }
  const p = points[Math.floor(points.length / 2)];
  return { x: p[0], y: p[1], horizontal: true };
}

// Assign a perpendicular offset to each edge so parallel edges between the
// same pair (or fan-in on one node) do not sit on top of each other.
export function pairOffsets(edges, step = 16) {
  const buckets = new Map();
  edges.forEach((edge, i) => {
    const key = [edge.from, edge.to].sort().join('|');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i);
  });
  const offsets = new Array(edges.length).fill(0);
  for (const indexes of buckets.values()) {
    const n = indexes.length;
    indexes.forEach((edgeIndex, k) => {
      offsets[edgeIndex] = (k - (n - 1) / 2) * step;
    });
  }
  return offsets;
}

// Spread edges that leave or enter the same node side so they get distinct
// ports, ordered by where the other end sits so they do not cross at the port.
export function portOffsets(edges, rects, step = 16) {
  const sides = edges.map((e) => {
    const a = rects.get(e.from); const b = rects.get(e.to);
    if (!a || !b) return null;
    if (e.from === e.to) return { fromSide: 'right', toSide: 'right' };
    return routeOrthogonal(a, b, 0);
  });
  const buckets = new Map();
  const push = (key, entry) => { if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(entry); };
  edges.forEach((e, i) => {
    if (!sides[i]) return;
    push(`${e.from}|${sides[i].fromSide}`, { i, end: 'from', other: rects.get(e.to) });
    push(`${e.to}|${sides[i].toSide}`, { i, end: 'to', other: rects.get(e.from) });
  });
  const out = edges.map(() => ({ from: 0, to: 0 }));
  for (const [key, list] of buckets) {
    if (list.length < 2) continue;
    const [nodeId, side] = key.split('|');
    const horizontalSide = side === 'left' || side === 'right';
    list.sort((p, q) => (horizontalSide
      ? (p.other.y + p.other.h / 2) - (q.other.y + q.other.h / 2)
      : (p.other.x + p.other.w / 2) - (q.other.x + q.other.w / 2)) || p.i - q.i);
    const rect = rects.get(nodeId);
    const span = horizontalSide ? rect.h : rect.w;
    const n = list.length;
    const s = Math.max(6, Math.min(step, (span - 20) / Math.max(1, n - 1)));
    list.forEach((p, k) => { out[p.i][p.end] = (k - (n - 1) / 2) * s; });
  }
  return out;
}

export function pointAt(points, t) {
  let total = 0; const segs = [];
  for (let i = 1; i < points.length; i += 1) { const len = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]); segs.push(len); total += len; }
  let target = total * t;
  for (let i = 0; i < segs.length; i += 1) {
    if (target <= segs[i]) { const k = segs[i] ? target / segs[i] : 0; const [x1, y1] = points[i]; const [x2, y2] = points[i + 1]; return { x: x1 + (x2 - x1) * k, y: y1 + (y2 - y1) * k }; }
    target -= segs[i];
  }
  const p = points[points.length - 1]; return { x: p[0], y: p[1] };
}

// Find a spot along the path for a label box that does not sit on a node or
// on another label. Falls back to the midpoint.
const MARKER_LEN = 24;
// Which way does the path run at fraction t? Used to nudge labels off the line.
function horizontalAt(points, t) {
  const segs = segmentsOf(points);
  let target = segs.reduce((sum, seg) => sum + seg.len, 0) * t;
  for (const seg of segs) {
    if (target <= seg.len) return seg.start[1] === seg.end[1];
    target -= seg.len;
  }
  return true;
}
export function placeLabel(points, lw, lh, obstacles) {
  if (!points.length) return { x: 0, y: 0, w: lw, h: lh };
  if (points.length < 2) return { x: points[0][0] - lw / 2, y: points[0][1] - lh / 2, w: lw, h: lh };
  const candidates = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82, 0.12, 0.88];
  const free = (box) => !obstacles.some((o) => rectsOverlap(box, o));
  const freeOfLabels = (box) => !obstacles.some((o) => o.label && rectsOverlap(box, o));
  const total = segmentsOf(points).reduce((sum, seg) => sum + seg.len, 0);
  // Keep the label clear of the cardinality/arrow markers at both ends.
  const clearOfMarkers = (t) => total < MARKER_LEN * 3 || (total * t >= MARKER_LEN + lw / 4 && total * (1 - t) >= MARKER_LEN + lw / 4);
  // Candidate box at fraction t, shifted k steps off the line (perpendicular).
  const boxAt = (t, k) => {
    const c = pointAt(points, t);
    const horizontal = horizontalAt(points, t);
    return horizontal
      ? { x: c.x - lw / 2, y: c.y - lh / 2 + k * (lh + 4), w: lw, h: lh }
      : { x: c.x - lw / 2 + k * (lw / 2 + 6), y: c.y - lh / 2, w: lw, h: lh };
  };
  // Pass 1: on the line. Pass 2+: nudged off the line, away from whatever it
  // collided with, so a label never sits on a node when any free spot exists.
  for (const k of [0, 1, -1, 2, -2, 3, -3]) {
    for (const t of candidates) {
      const box = boxAt(t, k);
      if (free(box) && clearOfMarkers(t)) return box;
    }
  }
  // Last resort: accept sitting on a node, but never on another label.
  for (const k of [0, 1, -1, 2, -2, 3, -3]) {
    for (const t of candidates) {
      const box = boxAt(t, k);
      if (freeOfLabels(box)) return box;
    }
  }
  return boxAt(0.5, 0);
}
