import { renderC4 } from '../c4/render-c4.mjs';

// A links spec drawn as a C4 container view: services are boxes, and each
// service pair is one arrow carrying the calls behind it.
export function linksToC4(spec) {
  const pairs = new Map();
  for (const l of spec.links) {
    const key = `${l.from}>${l.to}`;
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(l);
  }
  const count = (id, side) => spec.links.filter((l) => l[side] === id).length;
  const rank = ranks(spec.services.map((x) => x.id), [...pairs.keys()].map((k) => k.split('>')));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return {
    schema_version: 1,
    diagram_type: 'c4',
    meta: { ...spec.meta, level: 'container' },
    layout: { direction: 'lr', ...(spec.layout?.positions ? { positions: spec.layout.positions } : {}) },
    elements: spec.services.map((s) => ({
      id: s.id,
      kind: s.external ? 'system' : 'container',
      label: s.label,
      description: `${plural(count(s.id, 'from'), 'call')} out · ${count(s.id, 'to')} in`,
      row: rank.get(s.id),
      ...(s.external ? { external: true } : {}),
    })),
    relationships: [...pairs].map(([key, calls]) => {
      const [from, to] = key.split('>');
      const kinds = [...new Set(calls.map((c) => c.kind))];
      return {
        id: `${from}--${to}`,
        from,
        to,
        label: plural(calls.length, 'call'),
        technology: kinds.join(', ').toUpperCase(),
        ...(kinds.every((k) => k === 'webhook' || k === 'event') ? { style: 'dashed' } : {}),
        calls: calls.map((c) => ({ route: c.route, kind: c.kind, env: c.env || '' })),
      };
    }),
  };
}

// Callers left of the services they call. Calls that close a loop
// (A → B → A) are ignored for ranking, or the loop pushes both ends apart.
function ranks(ids, edges) {
  const out = new Map(ids.map((id) => [id, []]));
  for (const [a, b] of edges) out.get(a)?.push(b);
  const indegree = new Map(ids.map((id) => [id, 0]));
  for (const [, b] of edges) indegree.set(b, indegree.get(b) + 1);
  const order = [...ids].sort((a, b) => indegree.get(a) - indegree.get(b));
  const kept = [];
  const state = new Map();
  const visit = (id) => {
    state.set(id, 'open');
    for (const next of out.get(id)) {
      if (state.get(next) === 'open') continue;
      kept.push([id, next]);
      if (!state.has(next)) visit(next);
    }
    state.set(id, 'done');
  };
  for (const id of order) if (!state.has(id)) visit(id);
  const rank = new Map(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass += 1) {
    for (const [a, b] of kept) if (rank.get(b) < rank.get(a) + 1) rank.set(b, rank.get(a) + 1);
  }
  return rank;
}

export function renderLinks(spec) {
  const c4 = linksToC4(spec);
  return { ...renderC4(c4), embedSpec: c4 };
}
