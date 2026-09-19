import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc } from './utils.mjs';
import { validateSpec } from './validate.mjs';
import { RENDERERS, embeddable } from './render.mjs';
import { renderCards, renderLegend, assetSlots, fillSlots, embedJson, TOOLBAR_ACTIONS } from './template.mjs';
import { buildGraph, specId } from '../docs/graph.mjs';
import { renderDocsPanel, docsNavHtml } from '../docs/render-docs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DASHBOARD_TEMPLATE_PATH = path.resolve(here, '../../assets/dashboard.html');

const TYPE_LABEL = { erd: 'Data model', c4: 'Architecture', endpoints: 'APIs', lifecycle: 'Lifecycles' };
const TYPE_ORDER = ['c4', 'erd', 'endpoints', 'lifecycle'];

// Headline numbers per diagram type: [value, label] pairs, biggest first.
function metrics(spec) {
  const rels = (spec.relationships || []).length;
  switch (spec.diagram_type) {
    case 'erd': return [[spec.entities.length, 'entities'], [rels, 'relationships'], [(spec.groups || []).length, 'groups']];
    case 'c4': return [[spec.elements.length, 'elements'], [rels, 'relationships'], [(spec.boundaries || []).length, 'boundaries']];
    case 'lifecycle': return [[spec.states.length, 'states'], [(spec.transitions || []).length, 'transitions']];
    case 'endpoints': return [[spec.endpoints.length, 'endpoints'], [(spec.groups || []).length, 'groups'], [(spec.types || []).length, 'types']];
    default: return [];
  }
}

function nodeCount(spec) { return metrics(spec)[0]?.[0] ?? 0; }
function linkCount(spec) { return metrics(spec)[1]?.[1]?.match(/relationship|transition/) ? metrics(spec)[1][0] : 0; }

function countsHtml(spec) {
  const shown = metrics(spec).filter(([value], i) => i === 0 || value > 0);
  return `<div class="counts">${shown.map(([value, label]) => `<span><b>${value}</b> ${esc(label)}</span>`).join('')}</div>`;
}

// Prefix SVG-internal ids so several diagrams can live in one document.
function namespaceSvg(svg, prefix) {
  return svg
    .replace(/id="(m-[a-z-]+)"/g, `id="${prefix}$1"`)
    .replace(/url\(#(m-[a-z-]+)\)/g, `url(#${prefix}$1)`)
    .replace(/id="(node|edge)-/g, `id="${prefix}$1-`);
}

function panelHtml(index, spec, result) {
  return `
<section class="panel" data-panel="${index}">
  <div class="viewer" data-role="viewer">
    <header class="toolbar">
      <div class="titles">
        <h1>${esc(spec.meta.title)}</h1>
        <span class="type-badge ${esc(spec.diagram_type)}">${esc(spec.diagram_type)}</span>
        <p class="sub">${esc(spec.meta.subtitle || '')}</p>
      </div>
      ${TOOLBAR_ACTIONS}
    </header>
    <div class="viewer-body">
      <div class="canvas" data-role="canvas">${namespaceSvg(result.svg, `d${index}-`)}<div class="hint">drag to pan · wheel to zoom · click a node · Esc clears</div></div>
      <aside>
        <section><h2>Details</h2><div class="details" data-role="details" aria-live="polite"><p class="empty">Click a node or relationship.</p></div></section>
        <section><h2>Legend</h2>${renderLegend(result.legend)}</section>
        <section><h2>Stats</h2><div class="stats" data-role="stats"></div></section>
      </aside>
    </div>
    <div class="cards">${renderCards(spec.cards)}</div>
  </div>
</section>`;
}

function overviewHtml(title, subtitle, entries) {
  // Entity -> endpoints cross-reference, computed first so the header can count it.
  const erds = entries.filter((e) => e.spec.diagram_type === 'erd');
  const apis = entries.filter((e) => e.spec.diagram_type === 'endpoints');
  const rows = [];
  for (const erd of erds) {
    for (const entity of erd.spec.entities) {
      const touching = [];
      for (const api of apis) for (const ep of api.spec.endpoints) if ((ep.entities || []).includes(entity.id)) touching.push({ api, ep });
      if (touching.length) {
        rows.push({
          count: touching.length,
          html: `<tr><td><button type="button" class="chip link" data-goto-panel="${erd.index}" data-goto-node="${esc(entity.id)}">${esc(entity.name)}</button></td><td>${touching.map(({ api, ep }) => `<button type="button" class="chip link" data-goto-panel="${api.index}" data-goto-node="${esc(ep.id)}">${esc(`${ep.method} ${ep.path}`)}</button>`).join(' ')}</td></tr>`,
        });
      }
    }
  }
  const totals = [
    [entries.length, entries.length === 1 ? 'diagram' : 'diagrams'],
    [entries.reduce((n, e) => n + nodeCount(e.spec), 0), 'nodes'],
    [entries.reduce((n, e) => n + linkCount(e.spec), 0), 'connections'],
    [rows.reduce((n, r) => n + r.count, 0), 'cross-links'],
  ].filter(([value], i) => i < 3 || value > 0);

  let out = `<header class="ov-head"><h1>${esc(title)}</h1><p class="lead">${esc(subtitle || 'Click a diagram to open it, or follow the links between them.')}</p>`;
  out += `<div class="stat-strip">${totals.map(([value, label]) => `<div class="stat"><b>${value}</b><span>${esc(label)}</span></div>`).join('')}</div></header>`;

  for (const type of TYPE_ORDER) {
    const group = entries.filter((e) => e.spec.diagram_type === type);
    if (!group.length) continue;
    out += `<h2>${esc(TYPE_LABEL[type])}</h2><div class="tiles">`;
    for (const e of group) {
      out += `<a class="tile" href="#d=${e.index}" data-goto-panel="${e.index}"><div class="row"><h3>${esc(e.spec.meta.title)}</h3><span class="type-badge ${type}">${type}</span></div>`;
      const blurb = e.spec.meta.subtitle || e.spec.meta.description || '';
      out += `<div class="sub">${esc(blurb)}</div>`;
      out += `${countsHtml(e.spec)}</a>`;
    }
    out += '</div>';
  }

  if (erds.length && apis.length) {
    out += '<h2>Which endpoints touch which tables</h2>';
    out += rows.length
      ? `<div class="xlinks"><table><tbody>${rows.map((r) => r.html).join('')}</tbody></table></div>`
      : '<p class="empty-note">No links yet. Add ERD entity ids to <code>endpoints[].entities</code> to see them here.</p>';
  }

  // C4 drill-down links that resolve to a diagram in this dashboard.
  const drill = [];
  for (const e of entries.filter((x) => x.spec.diagram_type === 'c4')) {
    for (const el of e.spec.elements) {
      if (!el.link) continue;
      const base = String(el.link).split('/').pop().replace(/\.html$/, '');
      const target = entries.find((t) => t.file === base);
      if (target) drill.push(`<tr><td><button type="button" class="chip link" data-goto-panel="${e.index}" data-goto-node="${esc(el.id)}">${esc(el.label)}</button></td><td><span class="arrow">&rarr;</span> <button type="button" class="chip link" data-goto-panel="${target.index}">${esc(target.spec.meta.title)}</button></td></tr>`);
    }
  }
  if (drill.length) out += `<h2>Drill-down</h2><div class="xlinks"><table><tbody>${drill.join('')}</tbody></table></div>`;
  return out;
}

export function loadDashboardTemplate(templatePath = DASHBOARD_TEMPLATE_PATH) {
  return fs.readFileSync(templatePath, 'utf8');
}

// specs: array of { spec, file } where file is the spec's basename without extension.
export function renderDashboard(items, { title = 'Architecture', subtitle, theme, anchorStatus = null, commit = null, now } = {}) {
  const entries = [];
  const problems = [];
  const docsSpecs = [];
  items.forEach(({ spec, file }) => {
    const report = validateSpec(spec);
    if (!report.ok) { problems.push({ file, errors: report.errors }); return; }
    // A docs spec has no renderer and must not take a panel index.
    if (spec.diagram_type === 'docs') { docsSpecs.push({ spec, file }); return; }
    entries.push({ spec, file, index: entries.length });
  });
  entries.sort((a, b) => TYPE_ORDER.indexOf(a.spec.diagram_type) - TYPE_ORDER.indexOf(b.spec.diagram_type));
  entries.forEach((e, i) => { e.index = i; });
  const warnings = [];
  let nav = '';
  let panels = '';
  for (const type of TYPE_ORDER) {
    const group = entries.filter((e) => e.spec.diagram_type === type);
    if (!group.length) continue;
    nav += `<div class="group"><h2>${esc(TYPE_LABEL[type])}</h2>`;
    for (const e of group) {
      const result = RENDERERS[type](e.spec);
      for (const w of result.warnings || []) warnings.push(`${e.file}: ${w}`);
      nav += `<a href="#d=${e.index}" data-panel="${e.index}" data-type="${type}"><span class="dot"></span><span class="t">${esc(e.spec.meta.title)}</span><span class="n">${nodeCount(e.spec)}</span></a>`;
      panels += panelHtml(e.index, e.spec, result);
      e.embed = embeddable(e.spec, result);
    }
    nav += '</div>';
  }
  // Documentation panels, one per docs spec, first in the nav: the prose is the
  // way in and the diagrams are the detail. Several docs specs is the normal
  // case — one per topic ("how authentication works") reads far better than one
  // document trying to be the whole system.
  const docsGraphs = [];
  if (docsSpecs.length) {
    const byId = new Map(entries.map((e) => [specId(e.spec, e.file), e.spec]));
    const panelOf = new Map(entries.map((e) => [specId(e.spec, e.file), e.index]));
    const labelOf = new Map(entries.map((e) => [specId(e.spec, e.file), e.spec.meta.title || e.file]));

    docsSpecs.sort((a, b) => String(a.spec.meta?.title || a.file).localeCompare(String(b.spec.meta?.title || b.file)));

    let docsNav = '';
    let docsPanels = '';
    docsSpecs.forEach(({ spec, file }, i) => {
      const graph = buildGraph(spec, {
        specs: byId,
        anchorStatus: typeof anchorStatus === 'function' ? anchorStatus(spec, file) : (docsSpecs.length === 1 ? anchorStatus : null),
        ...(commit ? { commit } : {}),
        ...(now ? { now } : {}),
      });
      const subjectLabel = new Map(graph.subjects.map((sub) => [sub.ref, sub.label]));
      const resolveSubject = (ref) => {
        const [sid, node] = String(ref).split('#');
        if (!panelOf.has(sid)) return null;
        return { panel: panelOf.get(sid), node: node || null, label: subjectLabel.get(ref) || labelOf.get(sid) || ref };
      };
      const panelId = `docs-${i}`;
      docsNav += docsNavHtml(graph, panelId);
      docsPanels += renderDocsPanel(graph, { resolveSubject, panelId });
      graph.__panel = panelId;
      docsGraphs.push(graph);
    });
    nav = `<div class="group"><h2>Documentation</h2>${docsNav}</div>` + nav;
    panels = docsPanels + panels;
  }

  const html = fillSlots(loadDashboardTemplate(), {
    ...assetSlots(),
    TITLE: esc(title),
    SUBTITLE: esc(subtitle || `${entries.length} diagrams`),
    THEME: esc(theme || 'auto'),
    NAV: nav,
    PANELS: panels,
    OVERVIEW: `<div class="overview">${overviewHtml(title, subtitle, entries)}</div>`,
    SPECS: embedJson(entries.map((e) => ({ ...(e.embed || e.spec), __file: e.file }))),
  });
  return { html, entries, problems, warnings, docsGraphs, docsGraph: docsGraphs[0] || null };
}
