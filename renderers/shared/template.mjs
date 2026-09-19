import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc } from './utils.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const TEMPLATE_PATH = path.resolve(here, '../../assets/template.html');
export const VIEWER_JS_PATH = path.resolve(here, '../../assets/viewer.js');
export const VIEWER_CSS_PATH = path.resolve(here, '../../assets/viewer.css');

const SLOTS = ['<!-- VIBEX:TITLE -->', '<!-- VIBEX:SUBTITLE -->', '<!-- VIBEX:SVG -->', '<!-- VIBEX:LEGEND -->', '<!-- VIBEX:CARDS -->', '<!-- VIBEX:SPEC -->', '<!-- VIBEX:TYPE -->', '<!-- VIBEX:THEME -->', '<!-- VIBEX:CSS -->', '<!-- VIBEX:VIEWER_JS -->', '<!-- VIBEX:ACTIONS -->'];

// Inline stroke icons. No icon font, no network request, themed by currentColor.
export const ICON = {
  search: '<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7.2" cy="7.2" r="4.3"/><path d="M10.4 10.4 13.6 13.6"/></svg>',
  minus: '<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.8 8h8.4"/></svg>',
  plus: '<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.8v8.4M3.8 8h8.4"/></svg>',
  fit: '<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.4 6V3.4a1 1 0 0 1 1-1H6M13.6 6V3.4a1 1 0 0 0-1-1H10M2.4 10v2.6a1 1 0 0 0 1 1H6M13.6 10v2.6a1 1 0 0 1-1 1H10"/></svg>',
  sun: '<svg class="i i-sun" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.9"/><path d="M8 1.2v1.5M8 13.3v1.5M14.8 8h-1.5M2.7 8H1.2M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1M12.8 12.8l-1.1-1.1M4.3 4.3 3.2 3.2"/></svg>',
  moon: '<svg class="i i-moon" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.4 9.7A5.9 5.9 0 0 1 6.3 2.6a5.9 5.9 0 1 0 7.1 7.1Z"/></svg>',
  download: '<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2v7.2M5.2 6.8 8 9.6l2.8-2.8M2.8 12.8h10.4"/></svg>',
};

// The toolbar controls are identical on a single page and on every dashboard
// panel, so both shells render this one string.
export const TOOLBAR_ACTIONS = `<div class="tools">
      <label class="field">${ICON.search}<input data-role="search" type="search" placeholder="Search" aria-label="Search this diagram"><kbd>/</kbd></label>
      <div class="seg" role="group" aria-label="Zoom">
        <button type="button" data-role="zoom-out" title="Zoom out (-)" aria-label="Zoom out">${ICON.minus}</button>
        <button type="button" data-role="zoom-fit" title="Fit to screen (0)">${ICON.fit}<span>Fit</span></button>
        <button type="button" data-role="zoom-in" title="Zoom in (+)" aria-label="Zoom in">${ICON.plus}</button>
      </div>
      <div class="seg" role="group" aria-label="Export">
        <button type="button" data-role="export-svg" title="Download as SVG">${ICON.download}<span>SVG</span></button>
        <button type="button" data-role="export-png" title="Download as PNG"><span>PNG</span></button>
      </div>
      <button type="button" class="icon" data-role="theme" title="Toggle light / dark (t)" aria-label="Toggle light or dark theme">${ICON.sun}${ICON.moon}</button>
    </div>`;

// The viewer runtime and stylesheet are inlined so the output stays one file.
export function assetSlots() {
  return {
    VIEWER_JS: fs.readFileSync(VIEWER_JS_PATH, 'utf8').replace(/<\/script/gi, '<\\/script'),
    CSS: fs.readFileSync(VIEWER_CSS_PATH, 'utf8'),
    ACTIONS: TOOLBAR_ACTIONS,
  };
}

// Replace every <!-- VIBEX:NAME --> slot in one pass. Substituted content is
// never rescanned, so a spec string that happens to contain a slot marker
// cannot pull another slot's HTML into itself.
export function fillSlots(template, values) {
  return template.replace(/<!-- VIBEX:([A-Z_]+) -->/g, (m, name) => (values[name] !== undefined ? values[name] : m));
}

// JSON for a <script type="application/json"> block. "<" is escaped as \u003c,
// which is valid JSON and removes both "</script" and "<!--" from the output.
export function embedJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function loadTemplate(templatePath = TEMPLATE_PATH) {
  const template = fs.readFileSync(templatePath, 'utf8');
  for (const slot of SLOTS) {
    if (!template.includes(slot)) throw new Error(`template is missing slot ${slot}`);
  }
  return template;
}

export function renderCards(cards = []) {
  if (!cards.length) return '';
  return cards.map((card) => `
    <section class="card card-${esc(card.tone || 'neutral')}">
      <h3>${esc(card.title)}</h3>
      <ul>${card.items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
    </section>`).join('');
}

export function renderLegend(entries = []) {
  if (!entries.length) return '';
  return `<ul class="legend">${entries.map((e) => `
    <li><span class="swatch ${esc(e.className || '')}" style="${esc(e.style || '')}">${e.glyph || ''}</span><span>${esc(e.label)}</span></li>`).join('')}</ul>`;
}

export function applyTemplate(template, { spec, svg, legend, embedSpec = spec }) {
  return fillSlots(template, {
    ...assetSlots(),
    TITLE: esc(spec.meta.title),
    SUBTITLE: esc(spec.meta.subtitle || ''),
    TYPE: esc(spec.diagram_type),
    THEME: esc(spec.meta.theme || 'auto'),
    SVG: svg,
    LEGEND: renderLegend(legend),
    CARDS: renderCards(spec.cards),
    SPEC: embedJson(embedSpec),
  });
}
