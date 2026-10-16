import { esc, svgText, nodeAttrs, edgeAttrs, truncate, textWidth, wrapText, fitChars, num } from '../shared/utils.mjs';
import { wrapSvg } from '../shared/svgdoc.mjs';
import { isMessage, isNote, isFragment, branchesOf, messagesOf } from './steps.mjs';

const MARGIN = 40;
const HEAD_H = 50;
const MIN_W = 120;
const MIN_GAP = 60;
const BAR = 10;
const SELF_W = 36;
const LABEL_CHARS = 48;
const FRAG_HEAD = 24;
const NOTE_CHARS = 34;

function headWidth(p) {
  return Math.max(MIN_W, Math.min(220, textWidth(p.label, 13) + 32));
}

function messageLines(m, n) {
  const lines = [];
  const first = m.label || '';
  if (first || n) lines.push({ text: truncate(n ? `${n}. ${first}` : first, LABEL_CHARS), cls: 'label' });
  if (m.detail) lines.push({ text: truncate(m.detail, LABEL_CHARS), cls: 'label tech' });
  return lines;
}

function linesWidth(lines) {
  return Math.max(0, ...lines.map((l) => textWidth(l.text, l.cls.includes('tech') ? 10.5 : 11.5)));
}

function noteLines(text) {
  return wrapText(text, NOTE_CHARS, 4);
}

// Fragments nested inside this one; outer frames get the wider margin so the
// frames sit inside each other instead of on top of each other.
function depthBelow(step) {
  if (!isFragment(step)) return -1;
  let d = 0;
  for (const b of branchesOf(step)) for (const s of b?.steps || []) d = Math.max(d, depthBelow(s) + 1);
  return d;
}

function touched(step, out = new Set()) {
  if (isMessage(step)) { out.add(step.from); out.add(step.to); }
  else if (isNote(step)) for (const p of step.over || []) out.add(p);
  else if (isFragment(step)) for (const b of branchesOf(step)) for (const s of b?.steps || []) touched(s, out);
  return out;
}

// Lifeline x positions: left to right in participant order, each pushed far
// enough from every earlier one that the labels between them fit.
function columns(spec, numbered, gapX) {
  const parts = spec.participants;
  const col = new Map(parts.map((p, i) => [p.id, i]));
  const widths = parts.map(headWidth);
  const need = [];
  messagesOf(spec.steps).forEach((m, i) => {
    const a = col.get(m.from); const b = col.get(m.to);
    if (a === undefined || b === undefined) return;
    const w = linesWidth(messageLines(m, numbered ? i + 1 : 0));
    if (a === b) { if (a + 1 < parts.length) need.push([a, a + 1, w + SELF_W + 28]); }
    else need.push([Math.min(a, b), Math.max(a, b), w + 36]);
  });
  const notes = [];
  const walk = (steps) => (steps || []).forEach((s) => {
    if (isNote(s)) notes.push(s);
    else if (isFragment(s)) branchesOf(s).forEach((b) => walk(b?.steps));
  });
  walk(spec.steps);
  for (const n of notes) {
    const w = Math.max(...noteLines(n.note).map((l) => textWidth(l, 11))) + 24;
    const ids = (n.over || []).map((id) => col.get(id)).filter((c) => c !== undefined);
    if (ids.length === 1 && ids[0] + 1 < parts.length) need.push([ids[0], ids[0] + 1, w + 24]);
  }
  const lead = 24 + 10 * Math.max(0, ...(spec.steps || []).map(depthBelow).map((d) => d + 1));
  const xs = [MARGIN + lead + widths[0] / 2];
  for (let j = 1; j < parts.length; j += 1) {
    let x = xs[j - 1] + Math.max(gapX, (widths[j - 1] + widths[j]) / 2 + 24);
    for (const [a, b, d] of need) if (b === j) x = Math.max(x, xs[a] + d);
    xs.push(x);
  }
  return { col, xs, widths };
}

function renderHead(p, x, y, w, { interactive = true } = {}) {
  const kind = p.kind || 'service';
  const left = x - w / 2;
  let out = interactive
    ? `<g${nodeAttrs(p.id, p.label, { class: `node sq-part ${kind}`, kind })}><title>${esc([p.label, p.technology, p.description].filter(Boolean).join(' · '))}</title>`
    : `<g class="sq-part sq-foot ${kind}" aria-hidden="true">`;
  if (kind === 'database') {
    const ry = 7;
    out += `<path class="box-shape" filter="url(#m-shadow)" d="M${left} ${y + ry} A${w / 2} ${ry} 0 0 1 ${left + w} ${y + ry} L${left + w} ${y + HEAD_H - ry} A${w / 2} ${ry} 0 0 1 ${left} ${y + HEAD_H - ry} Z"/>`;
    out += `<path class="db-line" d="M${left} ${y + ry} A${w / 2} ${ry} 0 0 0 ${left + w} ${y + ry}"/>`;
    out += `<rect class="box" x="${left}" y="${y}" width="${w}" height="${HEAD_H}" style="fill:none;stroke:none"/>`;
  } else {
    out += `<rect class="box" filter="url(#m-shadow)" x="${left}" y="${y}" width="${w}" height="${HEAD_H}" rx="${kind === 'person' ? HEAD_H / 2 : 8}"/>`;
  }
  const sub = p.technology || (kind === 'service' || kind === 'person' ? '' : kind);
  // The cylinder's top rim takes the first few pixels.
  const dy = kind === 'database' ? 5 : 0;
  out += svgText(x, y + dy + (sub ? 22 : 30), truncate(p.label, fitChars(w - 20, 13)), { cls: 'title', anchor: 'middle' });
  if (sub) out += svgText(x, y + dy + 37, truncate(sub, fitChars(w - 20, 10)), { cls: 'sub', anchor: 'middle' });
  return `${out}</g>`;
}

export function renderSequence(spec) {
  const layout = spec.layout || {};
  const numbered = layout.numbered !== false;
  const { col, xs, widths } = columns(spec, numbered, num(layout.gapX, MIN_GAP));
  const xOf = (id) => xs[col.get(id)];
  const top = MARGIN;
  let y = top + HEAD_H + 28;

  // Activation bars: a sync call opens one on the receiver, the receiver's
  // reply to that caller closes it. Nested calls stack to the right.
  const open = new Map(spec.participants.map((p) => [p.id, []]));
  const bars = [];
  const edgeX = (id, towardRight) => {
    const d = open.get(id)?.length || 0;
    const x = xOf(id);
    if (!d) return x;
    return towardRight ? x + BAR / 2 + (d - 1) * (BAR / 2) : x - BAR / 2;
  };

  let right = 0;
  const reach = (x) => { right = Math.max(right, x); };
  let frames = '';
  let frameLabels = '';
  let msgs = '';
  let notes = '';
  let index = 0;

  const drawMessage = (m) => {
    const i = index; index += 1;
    const kind = m.kind || 'sync';
    const lines = messageLines(m, numbered ? i + 1 : 0);
    const lh = lines.length * 13;
    const self = m.from === m.to;
    const base = edgeAttrs({ ...m, label: m.label || '' }, i);
    const cls = `edge sq-msg ${kind}${m.failure ? ' failure' : ''}${kind === 'reply' ? ' dashed' : ''}`;
    const marker = kind === 'sync' ? (m.failure ? 'm-arrow-failure' : 'm-arrow') : (m.failure ? 'm-open-failure' : 'm-open');
    const tip = [m.label, m.detail].filter(Boolean).join(' · ') || `${m.from} → ${m.to}`;
    let out = `<g${base.replace('class="edge"', `class="${cls}"`)}><title>${esc(`Step ${i + 1}: ${tip}`)}</title>`;
    if (self) {
      const ay = y + lh + 4;
      const x = edgeX(m.from, true);
      const d = `M ${x} ${ay} L ${x + SELF_W} ${ay} L ${x + SELF_W} ${ay + 20} L ${x + 2} ${ay + 20}`;
      out += `<path class="hit" d="${d}"/><path class="line" d="${d}" marker-end="url(#${marker})"/>`;
      const lx = x + SELF_W + 8;
      const lw = linesWidth(lines) + 10;
      if (lines.length) out += `<rect class="label-bg" x="${lx - 4}" y="${ay - 2}" width="${lw}" height="${lh + 6}"/>`;
      reach(lx + lw);
      lines.forEach((l, k) => { out += svgText(lx + 1, ay + 11 + k * 13, l.text, { cls: l.cls }); });
      y = ay + 34;
    } else {
      const ay = y + lh + 6;
      const right = xOf(m.to) > xOf(m.from);
      const x1 = edgeX(m.from, right);
      if (kind === 'sync') open.get(m.to).push({ y: ay, from: m.from, depth: open.get(m.to).length });
      const x2 = edgeX(m.to, !right);
      const d = `M ${x1} ${ay} L ${x2} ${ay}`;
      out += `<path class="hit" d="${d}"/><path class="line" d="${d}" marker-end="url(#${marker})"/>`;
      const cx = (x1 + x2) / 2;
      const lw = linesWidth(lines) + 10;
      if (lines.length) out += `<rect class="label-bg" x="${cx - lw / 2}" y="${y - 1}" width="${lw}" height="${lh + 3}"/>`;
      lines.forEach((l, k) => { out += svgText(cx, y + 10 + k * 13, l.text, { cls: l.cls, anchor: 'middle' }); });
      if (kind === 'reply') {
        const stack = open.get(m.from);
        const at = stack.map((b) => b.from).lastIndexOf(m.to);
        if (at !== -1) { const [b] = stack.splice(at, 1); bars.push({ id: m.from, ...b, end: ay }); }
      }
      y = ay + 16;
    }
    msgs += `${out}</g>`;
  };

  const drawNote = (n) => {
    const lines = noteLines(n.note);
    const w = Math.max(...lines.map((l) => textWidth(l, 11))) + 20;
    const h = lines.length * 14 + 10;
    const ids = (n.over || []).filter((id) => col.has(id));
    let x;
    let width = w;
    if (ids.length === 2) {
      const a = Math.min(xOf(ids[0]), xOf(ids[1])); const b = Math.max(xOf(ids[0]), xOf(ids[1]));
      width = Math.max(w, b - a + 40);
      x = (a + b) / 2 - width / 2;
    } else {
      x = xOf(ids[0]) + BAR;
    }
    reach(x + width);
    notes += `<g class="sq-note"><path class="note-box" d="M${x} ${y} L${x + width - 8} ${y} L${x + width} ${y + 8} L${x + width} ${y + h} L${x} ${y + h} Z"/>`;
    lines.forEach((l, k) => { notes += svgText(x + 10, y + 17 + k * 14, l, { cls: 'note-text' }); });
    notes += '</g>';
    y += h + 14;
  };

  const drawSteps = (steps) => (steps || []).forEach((s) => {
    if (isFragment(s)) drawFragment(s);
    else if (isNote(s)) drawNote(s);
    else if (isMessage(s)) drawMessage(s);
  });

  function drawFragment(f) {
    const ids = [...touched(f)].filter((id) => col.has(id));
    const pad = 20 + 10 * depthBelow(f);
    const cols = ids.map((id) => col.get(id));
    const lo = Math.min(...cols); const hi = Math.max(...cols);
    const selfLabel = Math.max(0, ...messagesOf([f]).filter((m) => m.from === m.to && col.get(m.from) === hi)
      .map((m) => linesWidth(messageLines(m, 99)) + SELF_W + 30));
    const x1 = xs[lo] - Math.max(pad, widths[lo] / 2 - 10);
    const x2 = xs[hi] + Math.max(pad, selfLabel ? selfLabel + pad : 0, widths[hi] / 2 - 10);
    reach(x2);
    const y1 = y;
    const branches = branchesOf(f);
    const dividers = [];
    y += FRAG_HEAD + 6;
    // Each branch is an alternative to the first, so it starts with the calls
    // that were in flight when the fragment began, not where the last ended.
    const snap = new Map([...open].map(([id, st]) => [id, st.map((x) => ({ ...x }))]));
    branches.forEach((b, k) => {
      if (k) {
        dividers.push({ y, label: b?.label });
        for (const [id, st] of open) for (const x of st) bars.push({ id, ...x, end: y });
        for (const [id, st] of snap) open.set(id, st.map((x) => ({ ...x, y })));
        y += 22;
      }
      drawSteps(b?.steps);
    });
    y += 4;
    const tag = f.fragment;
    const tagW = textWidth(tag, 10.5) + 18;
    let out = `<g class="sq-frag ${tag}"><rect class="frame" x="${x1}" y="${y1}" width="${x2 - x1}" height="${y - y1}"/>`;
    for (const d of dividers) out += `<path class="divider" d="M${x1} ${d.y} L${x2} ${d.y}"/>`;
    frames += `${out}</g>`;
    // Conditions are drawn above lifelines and activation bars, on a backing,
    // or a bar running down the frame's left side blanks them out.
    const cond = (x, cy, text) => {
      const t = `[${truncate(text, 60)}]`;
      const w = textWidth(t, 11) + 8;
      return `<rect class="cond-bg" x="${x - 4}" y="${cy - 12}" width="${w}" height="16"/>${svgText(x, cy, t, { cls: 'cond' })}`;
    };
    let lab = `<g class="sq-frag ${tag}"><path class="tab" d="M${x1} ${y1} L${x1 + tagW} ${y1} L${x1 + tagW} ${y1 + FRAG_HEAD - 7} L${x1 + tagW - 7} ${y1 + FRAG_HEAD} L${x1} ${y1 + FRAG_HEAD} Z"/>`;
    lab += svgText(x1 + 8, y1 + 16, tag, { cls: 'tag' });
    if (branches[0]?.label) lab += cond(x1 + tagW + 8, y1 + 16, branches[0].label);
    for (const d of dividers) if (d.label) lab += cond(x1 + 8, d.y + 15, d.label);
    frameLabels += `${lab}</g>`;
    y += 12;
  }

  drawSteps(spec.steps);
  const bottom = y + 6;
  for (const [id, stack] of open) for (const b of stack) bars.push({ id, ...b, end: bottom - 8 });

  let lifelines = '';
  for (const p of spec.participants) lifelines += `<path class="sq-lifeline" d="M${xOf(p.id)} ${top + HEAD_H} L${xOf(p.id)} ${bottom}"/>`;
  let barSvg = '';
  for (const b of bars.sort((p, q) => p.depth - q.depth)) {
    barSvg += `<rect class="sq-bar" x="${xOf(b.id) - BAR / 2 + b.depth * (BAR / 2)}" y="${b.y}" width="${BAR}" height="${Math.max(8, b.end - b.y)}"/>`;
  }
  const all = messagesOf(spec.steps);
  // A long flow scrolls the heads out of view, so they are repeated at the foot.
  const foot = all.length > 10;
  let heads = '';
  spec.participants.forEach((p, i) => {
    heads += renderHead(p, xs[i], top, widths[i]);
    if (foot) heads += renderHead(p, xs[i], bottom, widths[i], { interactive: false });
  });

  const width = Math.max(xs[xs.length - 1] + widths[widths.length - 1] / 2, right) + MARGIN;
  const height = (foot ? bottom + HEAD_H : bottom) + MARGIN;

  const body = frames + lifelines + barSvg + msgs + frameLabels + notes + heads;
  const theme = spec.meta.theme === 'dark' ? 'dark' : 'light';
  const svg = wrapSvg({ body, width, height, title: spec.meta.title, theme, diagramType: 'sequence', proposed: spec.meta.proposed === true });
  const kinds = new Set(all.map((m) => m.kind || 'sync'));
  const legend = [
    { key: 'sync', label: 'Call, waits for the answer', className: 'text', glyph: '→' },
    { key: 'async', label: 'Async, fire and forget', className: 'text', glyph: '⇾' },
    { key: 'reply', label: 'Reply (dashed)', className: 'text', glyph: '⇠' },
  ].filter((l) => kinds.has(l.key));
  if (all.some((m) => m.failure)) legend.push({ label: 'Red = failure path', className: 'text', glyph: '→', style: 'color:var(--lc-failure)' });
  if (bars.length) legend.push({ label: 'Bar = busy handling a call', className: 'text', glyph: '▮' });
  // The viewer looks messages up by edge id, so it gets them flat.
  const embedSpec = { ...spec, messages: all };
  return { svg, legend, width, height, warnings: [], embedSpec };
}
