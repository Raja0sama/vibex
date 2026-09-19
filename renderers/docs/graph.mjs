// Assembles the docs graph: every fact once, with provenance, addressable.
//
// Pure. The caller supplies the covered specs and, for anchored claims, the
// result of checking each anchor against the working tree — so this module can
// be tested without a repository and produces the same graph twice.
import { runGenerator, GENERATOR_TYPE } from './facts.mjs';
import { citationsIn } from './markdown.mjs';

const DAY = 86400000;

// Node collection and edge shape per diagram type. One table instead of four
// branches, so adding a type is a row rather than a rewrite.
const SHAPES = {
  erd: {
    nodes: (s) => (s.entities || []).map((e) => ({ id: e.id, label: e.name || e.id, kind: e.kind || 'table', sources: e.sources })),
    edges: (s) => (s.relationships || []).map((r) => ({ from: r.from, to: r.to, relation: 'references', reverse: 'referenced-by', label: r.label })),
  },
  c4: {
    nodes: (s) => [
      ...(s.elements || []).map((e) => ({ id: e.id, label: e.label || e.id, kind: e.external ? `${e.kind || 'system'} (external)` : (e.kind || 'container'), sources: e.sources })),
      ...(s.boundaries || []).map((b) => ({ id: b.id, label: b.label || b.id, kind: 'boundary' })),
    ],
    edges: (s) => (s.relationships || []).map((r) => ({ from: r.from, to: r.to, relation: 'connects-to', reverse: 'used-by', label: r.label })),
  },
  endpoints: {
    nodes: (s) => [
      ...(s.endpoints || []).map((e) => ({ id: e.id, label: `${e.method} ${e.path}`, kind: 'operation', sources: e.sources })),
      ...(s.types || []).map((t) => ({ id: t.id, label: t.name || t.id, kind: t.kind || 'type' })),
    ],
    // endpoint.entities cross-links an operation to the tables it touches.
    edges: (s) => (s.endpoints || []).flatMap((e) => (e.entities || []).map((x) => ({ from: e.id, to: x, relation: 'touches', reverse: 'touched-by', external: true }))),
  },
  lifecycle: {
    nodes: (s) => (s.states || []).map((st) => ({ id: st.id, label: st.label || st.id, kind: st.kind || 'normal', sources: st.sources })),
    edges: (s) => (s.transitions || []).map((t) => ({ from: t.from, to: t.to, relation: 'transitions-to', reverse: 'entered-from', label: t.event || t.label })),
  },
};

export function specId(spec, fallback) {
  return spec?.meta?.id || fallback;
}

// verified | proposed | asserted | stale | expired | broken — computed, never
// authored.
export function confidenceOf(claim, { anchorStatus, reviewWindowDays, now, proposed = false, proposedSpecs = null }) {
  const src = claim.source || {};
  // Nothing about something that does not exist can be verified against code.
  // Saying "verified" here would be true of the spec and false of the world.
  if (proposed || (src.kind === 'derived' && proposedSpecs?.has(src.spec))) {
    return { confidence: 'proposed', detail: proposed ? 'part of a proposal; nothing here exists yet' : `derived from ${src.spec}, which is a proposal` };
  }
  if (src.kind === 'derived') return { confidence: 'verified', detail: '' };

  if (src.kind === 'anchored') {
    const status = anchorStatus?.get(claim.id);
    // An anchored claim nobody verified establishes nothing. Saying so is the
    // difference between a document you can act on and one you hope is right.
    if (!status) return { confidence: 'broken', detail: 'anchor was not checked: the repository was not available to this build' };
    if (status.state === 'match') return { confidence: 'verified', detail: '' };
    if (status.state === 'changed') return { confidence: 'stale', detail: status.detail };
    return { confidence: 'broken', detail: status.detail };
  }

  const at = Date.parse(src.at);
  if (Number.isNaN(at)) return { confidence: 'expired', detail: 'no usable confirmation date' };
  const days = Math.floor((now - at) / DAY);
  if (days <= reviewWindowDays) return { confidence: 'asserted', detail: `stated by ${src.by}, confirmed ${days} day${days === 1 ? '' : 's'} ago` };
  return { confidence: 'expired', detail: `last confirmed by ${src.by} ${days} days ago, past the ${reviewWindowDays}-day review window` };
}

export function buildGraph(docsSpec, { specs = new Map(), anchorStatus = null, now = Date.now(), generator = 'vibex', commit = null, verifiedCommits = null } = {}) {
  const reviewWindowDays = docsSpec.review_window_days ?? 180;
  const covers = docsSpec.covers || [];
  const unknown = [];
  const proposed = docsSpec.meta?.proposed === true;
  // A real document may still derive facts from a spec that is a proposal.
  const proposedSpecs = new Set(covers.filter((id) => specs.get(id)?.meta?.proposed === true));

  // 1. Subjects, one per node across every covered spec, plus the spec itself.
  const subjects = new Map();
  const addSubject = (ref, s) => { if (!subjects.has(ref)) subjects.set(ref, { ref, claims: [], related: [], ...s }); };

  for (const id of covers) {
    const spec = specs.get(id);
    if (!spec) { unknown.push({ what: id, why: 'listed in covers but no such spec was given to the build; nothing from it is documented' }); continue; }
    const type = spec.diagram_type;
    const shape = SHAPES[type];
    if (!shape) { unknown.push({ what: id, why: `diagram_type "${type}" has no subject mapping` }); continue; }

    addSubject(id, { label: spec.meta?.title || id, kind: 'spec', spec: id, diagram_type: type });
    for (const n of shape.nodes(spec)) {
      addSubject(`${id}#${n.id}`, { label: n.label, kind: n.kind, spec: id, diagram_type: type, ...(n.sources ? { sources: n.sources } : {}) });
    }
    for (const e of shape.edges(spec)) {
      // `external: true` edges point at another spec's ids, which this build
      // may not have; record them only when both ends resolve.
      const from = `${id}#${e.from}`;
      const to = e.external ? [...subjects.keys()].find((k) => k.endsWith(`#${e.to}`) && !k.startsWith(`${id}#`)) : `${id}#${e.to}`;
      if (!to || !subjects.has(from) || !subjects.has(to)) continue;
      subjects.get(from).related.push({ ref: to, relation: e.relation, ...(e.label ? { label: e.label } : {}) });
      subjects.get(to).related.push({ ref: from, relation: e.reverse, ...(e.label ? { label: e.label } : {}) });
    }
  }

  // 2. Claims: derived first so a section's generated facts read before the
  //    authored commentary on them.
  const claims = [];
  const sections = [];
  const authored = new Map((docsSpec.claims || []).map((c) => [c.id, c]));
  const placed = new Set();
  const generatedCoverage = new Set();
  // Specs this document draws generated facts from. Only these are held to
  // "every subject should have a claim" — a document about one topic reads a
  // spec to cite two things in it, and reporting the other forty as gaps is
  // noise that teaches readers to skip the coverage block.
  const generatedFrom = new Set();

  for (const section of docsSpec.sections || []) {
    const ids = [];
    for (const gen of section.generate || []) {
      // `coverage` renders the graph's own coverage block; it derives no claims.
      if (gen === 'coverage') { generatedCoverage.add(section.id); continue; }
      const wanted = GENERATOR_TYPE[gen];
      let produced = 0;
      for (const id of covers) {
        const spec = specs.get(id);
        if (!spec || spec.diagram_type !== wanted) continue;
        for (const c of runGenerator(gen, spec, id)) { claims.push({ ...c, section: section.id }); ids.push(c.id); produced += 1; }
        if (produced) generatedFrom.add(id);
      }
      if (!produced) unknown.push({ what: `${section.id}.generate: ${gen}`, why: `no ${wanted} spec in covers, so this section generated nothing` });
    }
    for (const id of section.claims || []) {
      const c = authored.get(id);
      if (!c) continue;
      claims.push({ ...c, section: section.id });
      ids.push(id);
      placed.add(id);
    }
    // A claim cited in the prose belongs to this section even if it was not
    // listed, so the evidence sits under the paragraph that leans on it.
    const cited = section.narrative ? citationsIn(section.narrative) : [];
    for (const id of cited) {
      if (!authored.has(id) || ids.includes(id)) continue;
      claims.push({ ...authored.get(id), section: section.id });
      ids.push(id);
      placed.add(id);
    }
    sections.push({
      id: section.id,
      title: section.title,
      ...(section.summary ? { summary: section.summary } : {}),
      ...(section.narrative ? { narrative: section.narrative } : {}),
      ...(cited.length ? { cites: [...new Set(cited)] } : {}),
      ...(generatedCoverage.has(section.id) ? { renders: 'coverage' } : {}),
      claims: ids,
    });
  }
  // An authored claim with a subject but no section still belongs in the graph:
  // it renders on its subject's page.
  for (const [id, c] of authored) if (!placed.has(id)) claims.push({ ...c });

  // 3. Confidence, then index onto subjects.
  const checkedAt = new Date(now).toISOString();
  const counts = { claims: 0, verified: 0, proposed: 0, stale: 0, broken: 0, asserted: 0, expired: 0 };
  const superseded = new Map();
  for (const c of claims) if (c.supersedes) superseded.set(c.supersedes, c.id);

  const out = claims.map((c) => {
    const { confidence, detail } = confidenceOf(c, { anchorStatus, reviewWindowDays, now, proposed, proposedSpecs });
    counts.claims += 1; counts[confidence] += 1;
    const row = { ...c, confidence, checked_at: checkedAt };
    if (detail) row.detail = detail;
    // Provenance in time: the commit this anchor was last seen matching at.
    const at = verifiedCommits?.get(c.id);
    if (at && c.source?.kind === 'anchored') row.verified_commit = at;
    if (superseded.has(c.id)) row.superseded_by = superseded.get(c.id);
    if (c.subject && subjects.has(c.subject)) subjects.get(c.subject).claims.push(c.id);
    else if (c.subject) unknown.push({ what: c.id, why: `its subject "${c.subject}" is not a node in any covered spec` });
    return row;
  });

  // 4. Coverage: what was read, and what nobody accounted for.
  const specRows = covers.filter((id) => specs.has(id)).map((id) => ({
    id,
    diagram_type: specs.get(id).diagram_type,
    title: specs.get(id).meta?.title || id,
    subjects: [...subjects.values()].filter((s) => s.spec === id && s.kind !== 'spec').length,
    // "read for facts" vs "read only to resolve the subjects claims point at".
    generated: generatedFrom.has(id),
  }));

  for (const row of specRows) {
    if (!generatedFrom.has(row.id)) continue;
    const bare = [...subjects.values()].filter((s) => s.spec === row.id && s.kind !== 'spec' && !s.claims.length);
    if (bare.length) {
      unknown.push({
        what: `${row.id}: ${bare.length} of ${row.subjects} subjects have no claim`,
        why: `nothing is documented about ${bare.slice(0, 5).map((s) => s.label).join(', ')}${bare.length > 5 ? ', …' : ''}`,
      });
    }
  }

  return {
    schema_version: 1,
    artifact: 'docs-graph',
    generated_at: checkedAt,
    generator,
    project: {
      title: docsSpec.meta?.title,
      ...(proposed ? { proposed: true, ...(docsSpec.meta?.proposal ? { proposal: docsSpec.meta.proposal } : {}) } : {}),
      ...(docsSpec.meta?.subtitle ? { subtitle: docsSpec.meta.subtitle } : {}),
      ...(docsSpec.meta?.repository || commit
        ? { repository: { ...(docsSpec.meta?.repository || {}), ...(commit ? { revision: commit } : {}) } }
        : {}),
    },
    claims: out,
    subjects: [...subjects.values()],
    sections,
    glossary: docsSpec.glossary || [],
    coverage: {
      specs: specRows,
      counts,
      out_of_scope: docsSpec.coverage?.out_of_scope || [],
      ...(proposedSpecs.size ? { proposed_specs: [...proposedSpecs] } : {}),
      unknown,
    },
  };
}
