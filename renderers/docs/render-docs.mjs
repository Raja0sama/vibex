// Renders the fact graph as a reading surface.
//
// The design rule: a reader must never have to wonder how far a sentence can be
// trusted. Every claim carries its confidence and its source in the same line
// of sight as its text, and the coverage block is a section of the document
// rather than a footnote.
import { esc } from '../shared/utils.mjs';
import { renderMarkdown } from './markdown.mjs';
import { issueUrl, INTENTS } from '../shared/intake.mjs';
import { isSafeLink } from '../shared/validate.mjs';

const CONF_LABEL = {
  verified: 'verified',
  proposed: 'proposed',
  asserted: 'stated',
  stale: 'needs re-reading',
  broken: 'unverifiable',
  expired: 'out of date',
};

// Ordered worst-first: what needs attention is what a reader should see first.
const ATTENTION = ['broken', 'stale', 'expired'];
const TRUST_ORDER = ['verified', 'proposed', 'asserted', 'stale', 'expired', 'broken'];

function sourceLink(source, repository) {
  const url = repository?.url?.replace(/\/$/, '');
  if (!url) return null;
  const rev = repository.revision || 'HEAD';
  const line = Number.isInteger(source.line) ? `#L${source.line}` : '';
  return `${url}/blob/${rev}/${source.path}${line}`;
}

function provenance(claim, repository) {
  const s = claim.source || {};
  if (s.kind === 'derived') {
    return `<span class="src">computed from <code>${esc(s.spec)}</code> by <code>${esc(s.rule)}</code></span>`;
  }
  if (s.kind === 'anchored') {
    const where = `${s.path}${s.symbol ? ` › ${s.symbol}` : ''}`;
    const href = sourceLink(s, repository);
    const body = href
      ? `<a class="src code" href="${esc(href)}" target="_blank" rel="noreferrer noopener">${esc(where)}</a>`
      : `<span class="src code">${esc(where)}</span>`;
    return body;
  }
  if (s.kind === 'asserted') {
    return `<span class="src">stated by ${esc(s.by)} on ${esc(s.at)}</span>`;
  }
  return '';
}

const FLAG_ICON = '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V5.5a1 1 0 0 1 .6-.9C7 4 9 4 12 5.2s5 1.2 6.4.6a1 1 0 0 1 1.6.9v7.7a1 1 0 0 1-.6.9c-1.4.6-3.4.6-6.4-.6s-5-1.2-6.4-.6"/></svg>';

function flagHtml(claim, { repository, graph }) {
  const href = issueUrl({
    repository,
    intent: 'doc-problem',
    title: `${claim.text.slice(0, 70)}${claim.text.length > 70 ? '…' : ''}`,
    context: {
      document: graph.project?.id || graph.project?.title,
      claim: claim.id,
      confidence: claim.confidence,
      spec: claim.subject,
      commit: repository?.revision,
      built: graph.generated_at,
    },
  });
  if (!href) return '';
  return `<a class="flag" href="${esc(href)}" target="_blank" rel="noreferrer noopener" title="Something wrong with this? File it, with the context already filled in.">${FLAG_ICON}<span>Flag</span></a>`;
}

function claimHtml(claim, { repository, resolveSubject, graph }) {
  const conf = claim.confidence || 'verified';
  const subject = claim.subject ? resolveSubject(claim.subject) : null;
  const jump = subject
    ? `<button type="button" class="chip link" data-goto-panel="${esc(String(subject.panel))}"${subject.node ? ` data-goto-node="${esc(subject.node)}"` : ''}>${esc(subject.label)}</button>`
    : '';
  const why = claim.detail ? `<p class="why">${esc(claim.detail)}</p>` : '';
  const rationale = claim.source?.rationale ? `<p class="why rationale">${esc(claim.source.rationale)}</p>` : '';
  const tomb = claim.superseded_by ? `<p class="why">Replaced by <code>${esc(claim.superseded_by)}</code>.</p>` : '';
  const needle = `${claim.text} ${claim.id} ${claim.subject || ''}`.toLowerCase();

  return `<li class="claim" id="claim-${esc(claim.id)}" data-conf="${esc(conf)}" data-find="${esc(needle)}">
  <p class="text">${esc(claim.text)}</p>
  ${rationale}${why}${tomb}
  <div class="prov"><span class="conf ${esc(conf)}">${esc(CONF_LABEL[conf] || conf)}</span>${provenance(claim, repository)}${jump}${flagHtml(claim, { repository, graph })}</div>
</li>`;
}

function coverageHtml(graph) {
  const { specs, counts, out_of_scope: outOfScope, unknown } = graph.coverage;
  let out = '<div class="coverage">';

  out += '<h3>What was read</h3>';
  out += specs.length
    ? `<ul class="read">${specs.map((s) => `<li><b>${esc(s.title)}</b> <span class="muted">${esc(s.diagram_type)} · ${s.subjects} subjects · ${s.generated ? 'facts derived from it' : 'read only to resolve references'}</span></li>`).join('')}</ul>`
    : '<p class="empty-note">No specs were read, so nothing here is derived from a diagram.</p>';

  out += '<h3>Deliberately not covered</h3>';
  out += outOfScope.length
    ? `<dl class="scope">${outOfScope.map((o) => `<dt>${esc(o.area)}</dt><dd>${esc(o.reason)}</dd>`).join('')}</dl>`
    : '<p class="empty-note warn">This document names nothing as out of scope, so it reads as if it covers everything. It almost certainly does not.</p>';

  out += '<h3>Noticed and unaccounted for</h3>';
  out += unknown.length
    ? `<dl class="scope unknown">${unknown.map((u) => `<dt>${esc(u.what)}</dt><dd>${esc(u.why)}</dd>`).join('')}</dl>`
    : '<p class="empty-note">Nothing. Every subject has at least one claim and every covered spec was read.</p>';

  const unresolved = counts.stale + counts.broken + counts.expired;
  // "Checks out against the code" is the one sentence a proposal must never
  // print: there is no code, and saying so would undo the banner above it.
  const verdict = graph.project?.proposed
    ? `All ${counts.claims} claims describe something that does not exist. Nothing here has been, or can be, checked against code.`
    : unresolved
      ? `${unresolved} of ${counts.claims} claims cannot currently be trusted. Treat an absence of information here as unknown, not as “no”.`
      : `All ${counts.claims} claims check out against the code and the review window as of this build.`;
  out += `<p class="verdict ${graph.project?.proposed ? 'proposed' : unresolved ? 'warn' : 'ok'}">${verdict}</p>`;

  return `${out}</div>`;
}

function trustBar(counts) {
  const order = TRUST_ORDER;
  const total = counts.claims || 1;
  const segs = order.filter((k) => counts[k] > 0)
    .map((k) => `<span class="part ${k}" style="width:${((counts[k] / total) * 100).toFixed(2)}%" title="${counts[k]} ${CONF_LABEL[k]}"></span>`).join('');
  const rows = order.filter((k) => counts[k] > 0)
    .map((k) => `<li><span class="dot ${k}"></span><b>${counts[k]}</b> ${esc(CONF_LABEL[k])}</li>`).join('');
  return `<div class="trust"><div class="bar">${segs}</div><ul class="key">${rows}</ul></div>`;
}

export function renderDocsPanel(graph, { resolveSubject = () => null, panelId = 'docs' } = {}) {
  const repository = graph.project?.repository;
  const byId = new Map(graph.claims.map((c) => [c.id, c]));
  const ctx = { repository, resolveSubject, graph };

  // A citation is a claim's confidence made visible inside a sentence: the
  // reader sees which words are load-bearing without leaving the prose.
  const resolveCitation = (id) => {
    const c = byId.get(id);
    if (!c) return null;
    const conf = c.confidence || 'verified';
    return `<a class="cite ${esc(conf)}" href="#claim-${esc(id)}" title="${esc(`${CONF_LABEL[conf] || conf}: ${c.text}`)}"><span class="pip"></span></a>`;
  };

  let body = '';
  if (graph.project?.proposed) {
    const pr = graph.project.proposal || {};
    const trail = [
      pr.by ? `Proposed by ${esc(pr.by)}` : '',
      pr.at ? `on ${esc(pr.at)}` : '',
      pr.issue && isSafeLink(pr.issue) ? `· <a href="${esc(pr.issue)}" target="_blank" rel="noreferrer noopener">discussion</a>` : '',
    ].filter(Boolean).join(' ');
    body += `<div class="proposal-banner" role="note">
      <b>This is a proposal. Nothing described here exists.</b>
      ${pr.summary ? `<p>${esc(pr.summary)}</p>` : ''}
      ${trail ? `<p class="trail">${trail}</p>` : ''}
    </div>`;
  }
  for (const section of graph.sections) {
    body += `<section class="docs-section" id="section-${esc(section.id)}">`;
    body += `<h2>${esc(section.title)}</h2>`;
    if (section.summary) body += `<p class="lead">${esc(section.summary)}</p>`;
    if (section.narrative) body += `<div class="prose">${renderMarkdown(section.narrative, { resolveCitation })}</div>`;
    if (section.renders === 'coverage') body += coverageHtml(graph);

    const claims = section.claims.map((id) => byId.get(id)).filter(Boolean);
    if (claims.length) {
      const list = `<ul class="claims">${claims.map((c) => claimHtml(c, ctx)).join('')}</ul>`;
      // With prose above it, the claim list is the evidence behind the prose —
      // present, citable, and out of the way of reading.
      body += section.narrative
        ? `<details class="evidence"><summary>Evidence · ${claims.length} claim${claims.length === 1 ? '' : 's'}</summary>${list}</details>`
        : list;
    } else if (section.renders !== 'coverage') body += '<p class="empty-note">Nothing here yet.</p>';
    body += '</section>';
  }

  // Claims attached to a subject but placed in no section still belong to the
  // document; dropping them would silently lose facts.
  const placed = new Set(graph.sections.flatMap((s) => s.claims));
  const loose = graph.claims.filter((c) => !placed.has(c.id));
  if (loose.length) {
    body += `<section class="docs-section" id="section-unfiled"><h2>Also known</h2>
      <p class="lead">Claims attached to a subject but not filed under a heading.</p>
      <ul class="claims">${loose.map((c) => claimHtml(c, ctx)).join('')}</ul></section>`;
  }

  const attention = graph.claims.filter((c) => ATTENTION.includes(c.confidence));
  const glossary = graph.glossary || [];

  const aside = `<aside>
  <section><h2>Trust</h2>${trustBar(graph.coverage.counts)}</section>
  ${attention.length ? `<section><h2>Needs attention</h2><ul class="attn">${attention.slice(0, 12).map((c) => `<li><a href="#claim-${esc(c.id)}"><span class="conf ${esc(c.confidence)}">${esc(CONF_LABEL[c.confidence])}</span><span class="t">${esc(c.text.slice(0, 90))}</span></a></li>`).join('')}</ul></section>` : ''}
  ${glossary.length ? `<section><h2>Glossary</h2><dl class="gloss">${glossary.map((g) => `<dt>${esc(g.term)}</dt><dd>${esc(g.definition)}</dd>`).join('')}</dl></section>` : ''}
  <section><h2>Built</h2><p class="muted small">${esc(graph.generated_at)}<br>${esc(graph.generator || '')}</p></section>
</aside>`;

  const title = graph.project?.title || 'Documentation';
  const subtitle = graph.project?.subtitle || '';

  return `
<section class="panel docs" data-panel="${esc(panelId)}">
  <div class="docs-shell">
    <header class="toolbar">
      <div class="titles">
        <h1>${esc(title)}</h1>
        <span class="type-badge ${graph.project?.proposed ? 'proposed' : 'docs'}">${graph.project?.proposed ? 'proposal' : 'docs'}</span>
        <p class="sub">${esc(subtitle)}</p>
      </div>
      <div class="tools">
        ${askHtml(graph, repository)}
        <label class="field"><input type="search" data-role="docs-search" placeholder="Filter claims" aria-label="Filter claims"></label>
        <div class="seg" role="group" aria-label="Filter by confidence">
          <button type="button" data-docs-filter="all" class="on">All ${graph.coverage.counts.claims}</button>
          <button type="button" data-docs-filter="attention">Needs attention ${attention.length}</button>
        </div>
      </div>
    </header>
    <div class="docs-body">
      <article class="docs-main">${body}<p class="no-match" hidden>Nothing matches that filter.</p></article>
      ${aside}
    </div>
  </div>
</section>`;
}

// "Ask for something" rather than "open an issue": the person reading this is
// not necessarily someone who files issues, and that is the point.
function askHtml(graph, repository) {
  const ctx = { document: graph.project?.id || graph.project?.title, commit: repository?.revision, built: graph.generated_at };
  const items = [
    ['doc-request', 'Request a doc', 'Ask for something to be documented'],
    ['spec-gap', 'Report a gap', 'Tell us what is missing or wrong'],
    ['proposal', 'Propose a change', 'Describe something that does not exist yet'],
  ].map(([intent, label, hint]) => {
    const href = issueUrl({ repository, intent, title: '', context: ctx });
    return href ? `<a href="${esc(href)}" target="_blank" rel="noreferrer noopener" title="${esc(hint)}">${esc(label)}</a>` : '';
  }).filter(Boolean);
  if (!items.length) return '';
  return `<div class="seg ask" role="group" aria-label="${esc(INTENTS['doc-request'].label)}">${items.join('')}</div>`;
}

export function docsNavHtml(graph, panelId = 'docs') {
  const c = graph.coverage.counts;
  const attention = c.stale + c.broken + c.expired;
  const proposed = graph.project?.proposed;
  return `<a href="#${esc(panelId)}" data-panel="${esc(panelId)}" data-type="docs"${proposed ? ' data-proposed="true"' : ''}><span class="dot"></span><span class="t">${esc(graph.project?.title || 'Docs')}${proposed ? ' <em>proposal</em>' : ''}</span><span class="n${attention ? ' warn' : ''}">${attention || c.claims}</span></a>`;
}
