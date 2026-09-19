import { validateSpec } from './validate.mjs';
import { loadTemplate, applyTemplate } from './template.mjs';
import { renderErd } from '../erd/render-erd.mjs';
import { renderC4 } from '../c4/render-c4.mjs';
import { renderEndpoints } from '../endpoints/render-endpoints.mjs';
import { renderLifecycle } from '../lifecycle/render-lifecycle.mjs';

export const RENDERERS = { erd: renderErd, c4: renderC4, endpoints: renderEndpoints, lifecycle: renderLifecycle };

// The spec the viewer receives. Renderers may add synthetic items (for
// example the "Other" group for ungrouped endpoints) so every node drawn in
// the SVG has an entry the details panel can show.
export function embeddable(spec, result) {
  if (!result.syntheticGroups || !result.syntheticGroups.length) return spec;
  return { ...spec, groups: [...(spec.groups || []), ...result.syntheticGroups] };
}

// Validate, then render to a complete standalone HTML document.
// Returns html = null when validation fails.
export function renderSpec(spec) {
  const report = validateSpec(spec);
  if (!report.ok) return { report, html: null, warnings: [] };
  const template = loadTemplate();
  const result = RENDERERS[spec.diagram_type](spec);
  const html = applyTemplate(template, { spec, svg: result.svg, legend: result.legend, embedSpec: embeddable(spec, result) });
  return { report, html, warnings: result.warnings || [], width: result.width, height: result.height };
}
