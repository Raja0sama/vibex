import { validateSpec } from './validate.mjs';
import { loadTemplate, applyTemplate } from './template.mjs';
import { renderErd } from '../erd/render-erd.mjs';
import { renderC4 } from '../c4/render-c4.mjs';
import { renderEndpoints } from '../endpoints/render-endpoints.mjs';
import { renderLifecycle } from '../lifecycle/render-lifecycle.mjs';
import { renderLinks } from '../links/render-links.mjs';
import { toMermaid } from '../mermaid/to-mermaid.mjs';

export const RENDERERS = { erd: renderErd, c4: renderC4, endpoints: renderEndpoints, lifecycle: renderLifecycle, links: renderLinks };

// The spec the viewer receives. Renderers may add synthetic items (for
// example the "Other" group for ungrouped endpoints) so every node drawn in
// the SVG has an entry the details panel can show.
export function embeddable(spec, result, fileId) {
  let out = result.embedSpec || spec;
  if (!result.embedSpec && result.syntheticGroups?.length) out = { ...out, groups: [...(spec.groups || []), ...result.syntheticGroups] };
  // "Save layout" names the spec it came from; without meta.id, the file name
  // is the id, as it is everywhere else.
  if (!out.meta?.id && fileId) out = { ...out, meta: { ...out.meta, id: fileId } };
  // The Mermaid button exports this; built here so it matches the spec, not the page.
  return { ...out, __mermaid: toMermaid(spec) };
}

// Validate, then render. Returns html = null when validation fails.
export function renderSpec(spec, options = {}) {
  const report = validateSpec(spec);
  if (!report.ok) return { report, html: null, files: {}, warnings: [] };
  // A valid spec is not necessarily a drawable one: `docs` renders into the
  // dashboard, not to a standalone diagram.
  if (!RENDERERS[spec.diagram_type]) {
    report.error('not-a-diagram', `diagram_type "${spec.diagram_type}" has no diagram renderer; use "vibex ${spec.diagram_type}"${spec.diagram_type === 'docs' ? ' or include it in a dashboard' : ''}`, 'diagram_type');
    return { report, html: null, files: {}, warnings: [] };
  }
  const template = loadTemplate();
  const result = RENDERERS[spec.diagram_type](spec);
  const { html, files } = applyTemplate(template, { spec, svg: result.svg, legend: result.legend, embedSpec: embeddable(spec, result, options.specId) }, options);
  return { report, html, files, warnings: result.warnings || [], width: result.width, height: result.height };
}
