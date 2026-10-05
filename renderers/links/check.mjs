import { checkAnchor } from '../docs/anchors.mjs';

const PLACEHOLDER = '000000000000';

// "*" matches within one path segment, "**" across segments.
function globRe(glob) {
  const body = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
  return new RegExp(`^${body}$`);
}

// readerFor(repoName) returns readFile(relPath) -> text | null, or null when
// that repo was not given. repoName is '' for the default --repo.
export function checkLinks(spec, { readerFor, specs = new Map() }) {
  const services = new Map(spec.services.map((s) => [s.id, s]));
  const repoOf = (anchor, owner) => anchor.repo || services.get(owner)?.repo || '';

  function anchorState(anchor, owner) {
    if (!anchor) return { state: 'external', detail: '' };
    const repo = repoOf(anchor, owner);
    const read = readerFor(repo);
    if (!read) return { state: 'no-repo', detail: `no --repo given for "${repo || 'default'}"`, repo };
    const r = checkAnchor(anchor, read);
    if (r.state === 'changed' && anchor.hash === PLACEHOLDER) return { ...r, state: 'unhashed', detail: 'placeholder hash; run --reanchor', repo };
    if (r.state === 'changed') return { ...r, detail: `${anchor.path} changed since this call was last confirmed`, repo };
    return { ...r, repo };
  }

  function endpointState(ref) {
    if (!ref) return null;
    if (Array.isArray(ref)) return ref.map(endpointState).find((s) => s.state !== 'match') || { state: 'match', detail: '' };
    const [specId, node] = ref.split('#');
    const target = specs.get(specId);
    if (!target) return { state: 'unknown-spec', detail: `${specId} was not loaded` };
    const hit = (target.endpoints || []).some((e) => e.id === node);
    return hit ? { state: 'match', detail: '' } : { state: 'dangling', detail: `${node} is not an endpoint in ${specId}` };
  }

  const links = spec.links.map((l) => ({
    id: l.id,
    from: l.from,
    to: l.to,
    route: l.route,
    client: anchorState(l.client, l.from),
    handler: anchorState(l.handler, l.to),
    endpoint: endpointState(l.endpoint),
  }));

  // Endpoints a service declares that no link reaches: dead code, or a caller nobody documented.
  const called = new Set(spec.links.flatMap((l) => l.endpoint || []));
  const uncalled = [];
  for (const svc of spec.services) {
    const target = svc.spec && specs.get(svc.spec);
    if (!target) continue;
    const ignored = (svc.ignore || []).map(globRe);
    for (const e of target.endpoints || []) {
      if (ignored.some((re) => re.test(e.path))) continue;
      if (!called.has(`${svc.spec}#${e.id}`)) uncalled.push({ service: svc.id, endpoint: `${svc.spec}#${e.id}`, route: `${e.method} ${e.path}` });
    }
  }

  const bad = (s) => s && !['match', 'external'].includes(s.state);
  const broken = links.filter((l) => bad(l.client) || bad(l.handler) || bad(l.endpoint));
  const diagrams = checkDiagrams(spec, specs);
  const drift = diagrams.reduce((n, d) => n + d.unbacked.length + d.missing.length + d.undrawn.length, 0);
  return {
    links,
    uncalled,
    diagrams,
    counts: { links: links.length, ok: links.length - broken.length, broken: broken.length, uncalled: uncalled.length, drift },
  };
}

// Compare each C4 diagram the services are drawn in against the links.
// unbacked: an arrow between two services with no link behind it.
// missing: a service inside a boundary has links to a drawn service but no arrow.
// undrawn: a service inside the diagram's boundary is called by (or calls) a service the diagram leaves out.
function checkDiagrams(spec, specs) {
  const pairs = new Map();
  for (const l of spec.links) pairs.set(`${l.from}>${l.to}`, (pairs.get(`${l.from}>${l.to}`) || 0) + 1);
  const byDiagram = new Map();
  for (const svc of spec.services) {
    for (const ref of svc.c4 || []) {
      const [id, el] = ref.split('#');
      if (!byDiagram.has(id)) byDiagram.set(id, new Map());
      byDiagram.get(id).set(el, svc.id);
    }
  }
  const out = [];
  for (const [id, svcOf] of byDiagram) {
    const c4 = specs.get(id);
    if (!c4 || c4.diagram_type !== 'c4') { out.push({ spec: id, error: `${id} was not loaded`, unbacked: [], missing: [], undrawn: [] }); continue; }
    const drawn = new Set(svcOf.values());
    const arrows = new Set();
    for (const r of c4.relationships || []) {
      const a = svcOf.get(r.from); const b = svcOf.get(r.to);
      if (!a || !b || a === b) continue;
      arrows.add(`${a}>${b}`);
      if (r.direction === 'both') arrows.add(`${b}>${a}`);
    }
    const inBoundary = new Set((c4.boundaries || []).flatMap((b) => b.contains || []));
    const focus = new Set([...svcOf].filter(([el]) => inBoundary.has(el)).map(([, s]) => s));
    const unbacked = [...arrows].filter((k) => !pairs.has(k)).map((k) => { const [from, to] = k.split('>'); return { from, to }; });
    const missing = [];
    const undrawn = [];
    for (const [k, n] of pairs) {
      const [from, to] = k.split('>');
      const inside = focus.has(from) ? from : focus.has(to) ? to : null;
      if (drawn.has(from) && drawn.has(to)) { if (inside && !arrows.has(k)) missing.push({ from, to, links: n }); continue; }
      if (inside && (drawn.has(from) || drawn.has(to))) undrawn.push({ from, to, links: n, absent: inside === from ? to : from });
    }
    out.push({ spec: id, unbacked, missing, undrawn });
  }
  return out;
}

// New hashes for anchors whose code moved. Mutates spec; returns how many changed.
export function reanchorLinks(spec, result) {
  let updated = 0;
  const byId = new Map(result.links.map((r) => [r.id, r]));
  for (const l of spec.links) {
    const r = byId.get(l.id);
    for (const side of ['client', 'handler']) {
      if (l[side] && ['changed', 'unhashed'].includes(r[side].state)) { l[side].hash = r[side].hash; updated += 1; }
    }
  }
  return updated;
}
