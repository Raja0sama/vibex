// Dependency-free structural validation. Not a full JSON Schema engine:
// checks required fields, enums, id uniqueness, and reference integrity,
// which is what actually breaks a render. Schemas in /schemas stay the
// human-readable contract.

import { isWhitespaceSignificant } from '../docs/hash-mode.mjs';

const ID_RE = /^[a-zA-Z][a-zA-Z0-9_.-]*$/;

export const ENUMS = {
  erd: {
    entityKind: ['table', 'view', 'enum', 'embedded'],
    cardinality: ['one', 'zero-or-one', 'many', 'one-or-many'],
    onDelete: ['cascade', 'restrict', 'set-null', 'no-action'],
  },
  c4: {
    elementKind: ['person', 'system', 'container', 'component', 'database', 'queue'],
    boundaryKind: ['enterprise', 'system', 'container', 'deployment'],
    level: ['landscape', 'context', 'container', 'component'],
    direction: ['forward', 'both'],
    style: ['solid', 'dashed'],
  },
  endpoints: {
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'QUERY', 'MUTATION', 'SUBSCRIPTION', 'EVENT'],
    apiKind: ['rest', 'graphql', 'mixed'],
    typeKind: ['object', 'input', 'enum', 'interface', 'union', 'scalar'],
    paramIn: ['path', 'query', 'header', 'arg', 'body'],
  },
  lifecycle: {
    stateKind: ['initial', 'normal', 'waiting', 'terminal', 'failure'],
    transitionKind: ['normal', 'auto', 'timeout', 'failure'],
  },
  docs: {
    sourceKind: ['anchored', 'asserted'],
    hashMode: ['exact', 'loose'],
    generator: [
      'erd.entities', 'erd.relationships',
      'c4.elements', 'c4.relationships', 'c4.boundaries',
      'endpoints.operations', 'endpoints.types',
      'lifecycle.states', 'lifecycle.transitions',
      'coverage',
    ],
  },
  common: {
    theme: ['light', 'dark', 'auto'],
    tone: ['neutral', 'info', 'success', 'warning', 'danger'],
  },
};

class Report {
  constructor() { this.errors = []; this.warnings = []; }
  error(code, message, at) { this.errors.push({ severity: 'error', code, message, at }); }
  warn(code, message, at) { this.warnings.push({ severity: 'warning', code, message, at }); }
  get ok() { return this.errors.length === 0; }
}

function isObj(v) { return Boolean(v) && typeof v === 'object' && !Array.isArray(v); }

const MAX_CELL = 1000;
const HTTP_RE = /^https?:\/\//i;
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

// Only http(s) URLs and scheme-less relative paths may become href values.
export function isSafeLink(value) {
  return typeof value === 'string' && (HTTP_RE.test(value) || value.startsWith('//') || !SCHEME_RE.test(value));
}

function listIds(ids, cap = 10) {
  const all = [...ids];
  return all.length ? ` (known ids: ${all.slice(0, cap).join(', ')}${all.length > cap ? ', …' : ''})` : '';
}

// layout.* values are interpolated into SVG coordinates, so they must be numbers.
function checkLayout(report, layout, fields) {
  if (layout === undefined) return;
  if (!isObj(layout)) { report.error('type', 'layout must be an object', 'layout'); return; }
  for (const [name, rule] of Object.entries(fields)) {
    const v = layout[name];
    if (v === undefined) continue;
    const at = `layout.${name}`;
    if (rule === 'boolean') { if (typeof v !== 'boolean') report.error('type', `${at} must be true or false`, at); continue; }
    if (rule === 'enum') continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) { report.error('type', `${at} must be a number (got ${JSON.stringify(v)})`, at); continue; }
    if (rule === 'integer' && (!Number.isInteger(v) || v < 1)) report.error('range', `${at} must be an integer >= 1`, at);
    if (rule === 'number' && v < 0) report.error('range', `${at} must be >= 0`, at);
  }
}

// Explicit row/col: small non-negative integers, one item per cell.
function checkCells(report, items, at) {
  const taken = new Map();
  items.forEach((item, i) => {
    if (!isObj(item)) return;
    for (const key of ['row', 'col']) {
      const v = item[key];
      if (v !== undefined && (!Number.isInteger(v) || v < 0 || v > MAX_CELL)) {
        report.error('range', `${at}[${i}].${key} must be an integer between 0 and ${MAX_CELL}`, `${at}[${i}]`);
      }
    }
    if (Number.isInteger(item.row) && Number.isInteger(item.col)) {
      const cell = `${item.row}:${item.col}`;
      if (taken.has(cell)) report.error('duplicate-cell', `${at}[${i}] and ${at}[${taken.get(cell)}] both declare row ${item.row}, col ${item.col}`, `${at}[${i}]`);
      else taken.set(cell, i);
    }
  });
}

function checkEnum(report, value, allowed, at, optional = true) {
  if (value === undefined || value === null) {
    if (!optional) report.error('missing', `${at} is required`, at);
    return;
  }
  if (!allowed.includes(value)) report.error('enum', `${at} must be one of ${allowed.join(', ')} (got ${JSON.stringify(value)})`, at);
}

function checkIds(report, items, at) {
  const seen = new Set();
  const ids = new Set();
  (items || []).forEach((item, i) => {
    const id = item?.id;
    const where = `${at}[${i}]`;
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      report.error('id', `${where}.id must match ${ID_RE} (got ${JSON.stringify(id)})`, where);
      return;
    }
    if (seen.has(id)) report.error('duplicate-id', `${where}.id "${id}" is duplicated`, where);
    seen.add(id);
    ids.add(id);
  });
  return ids;
}

function checkSources(report, sources, at) {
  if (sources === undefined) return;
  if (!Array.isArray(sources)) { report.error('type', `${at} must be an array`, at); return; }
  sources.forEach((s, i) => {
    if (!isObj(s) || typeof s.path !== 'string' || !s.path) report.error('missing', `${at}[${i}].path is required`, `${at}[${i}]`);
    else if (s.path.startsWith('/') || s.path.startsWith('\\') || SCHEME_RE.test(s.path) || s.path.split(/[\\/]/).some((seg) => seg === '..')) {
      report.error('path', `${at}[${i}].path must be repo-relative (no leading slash, drive letter, scheme, or ".." segment)`, `${at}[${i}]`);
    }
  });
}

function checkProposal(report, meta) {
  if (meta.proposed !== undefined && typeof meta.proposed !== 'boolean') {
    report.error('type', 'meta.proposed must be true or false', 'meta.proposed');
  }
  if (meta.proposal === undefined) {
    // A proposal with no trail is indistinguishable from an assertion nobody
    // signed, which is the thing this flag exists to prevent.
    if (meta.proposed) report.warn('untraced-proposal', 'meta.proposed is set but meta.proposal is missing; say where the proposal came from and who is making it', 'meta');
    return;
  }
  if (!isObj(meta.proposal)) { report.error('type', 'meta.proposal must be an object', 'meta.proposal'); return; }
  if (!meta.proposed) report.warn('proposal-without-flag', 'meta.proposal is set but meta.proposed is not true, so this renders as though it describes something real', 'meta');
  if (meta.proposal.issue !== undefined && !isSafeLink(meta.proposal.issue)) {
    report.error('link', 'meta.proposal.issue must be an http(s) URL or a relative path', 'meta.proposal.issue');
  }
}

function checkCommon(report, spec) {
  if (spec.schema_version !== 1) report.error('schema_version', 'schema_version must be 1; add "schema_version": 1 at the top level', 'schema_version');
  if (!isObj(spec.meta)) { report.error('missing', 'meta is required', 'meta'); return; }
  if (typeof spec.meta.title !== 'string' || !spec.meta.title.trim()) report.error('missing', 'meta.title is required', 'meta.title');
  checkProposal(report, spec.meta);
  checkEnum(report, spec.meta.theme, ENUMS.common.theme, 'meta.theme');
  if (spec.meta.repository !== undefined) {
    if (!isObj(spec.meta.repository) || typeof spec.meta.repository.url !== 'string') report.error('missing', 'meta.repository.url is required when repository is set', 'meta.repository');
    else if (!HTTP_RE.test(spec.meta.repository.url)) report.error('url', 'meta.repository.url must start with http:// or https://', 'meta.repository.url');
  }
  if (spec.cards !== undefined) {
    if (!Array.isArray(spec.cards)) report.error('type', 'cards must be an array', 'cards');
    else {
      spec.cards.forEach((c, i) => {
        if (!isObj(c) || typeof c.title !== 'string' || !Array.isArray(c.items) || !c.items.every((it) => typeof it === 'string')) report.error('missing', `cards[${i}] needs title and items[] of strings`, `cards[${i}]`);
        else checkEnum(report, c.tone, ENUMS.common.tone, `cards[${i}].tone`);
      });
      if (spec.cards.length > 4) report.warn('cards', 'More than 4 cards gets noisy; keep the ones a reader needs', 'cards');
    }
  }
}

export function validateErd(spec, report = new Report()) {
  checkCommon(report, spec);
  checkLayout(report, spec.layout, { cols: 'integer', gapX: 'number', gapY: 'number', maxWidth: 'number' });
  if (!Array.isArray(spec.entities) || !spec.entities.length) { report.error('missing', 'entities must be a non-empty array', 'entities'); return report; }
  const entityIds = checkIds(report, spec.entities, 'entities');
  checkCells(report, spec.entities, 'entities');
  spec.entities.forEach((e, i) => {
    const at = `entities[${i}]`;
    if (!isObj(e)) { report.error('type', `${at} must be an object`, at); return; }
    if (typeof e.name !== 'string' || !e.name) report.error('missing', `${at}.name is required`, at);
    checkEnum(report, e.kind, ENUMS.erd.entityKind, `${at}.kind`);
    checkSources(report, e.sources, `${at}.sources`);
    const cols = e.columns || [];
    if (!Array.isArray(cols)) report.error('type', `${at}.columns must be an array`, at);
    else {
      if (!cols.length && e.kind !== 'enum') report.warn('empty', `${at} (${e.name}) has no columns`, at);
      const names = new Set();
      cols.forEach((c, j) => {
        if (!isObj(c) || typeof c.name !== 'string') { report.error('missing', `${at}.columns[${j}].name is required`, at); return; }
        if (names.has(c.name)) report.error('duplicate-column', `${at} column "${c.name}" is duplicated`, at);
        names.add(c.name);
        if (c.fk !== undefined) {
          const [target] = String(c.fk).split('.');
          if (!entityIds.has(target)) report.error('dangling-fk', `${at}.columns[${j}].fk "${c.fk}" points to unknown entity "${target}"`, at);
        }
      });
    }
    if (e.kind === 'enum' && !Array.isArray(e.values)) report.warn('enum-values', `${at} (${e.name}) is an enum without values[]`, at);
  });
  if (spec.groups !== undefined) {
    if (!Array.isArray(spec.groups)) report.error('type', 'groups must be an array', 'groups');
    else {
      for (const id of checkIds(report, spec.groups, 'groups')) {
        if (entityIds.has(id)) report.error('id-clash', `group id "${id}" clashes with an entity id`, 'groups');
      }
      const membership = new Map();
      spec.groups.forEach((g, i) => {
        const at = `groups[${i}]`;
        if (!isObj(g)) { report.error('type', `${at} must be an object`, at); return; }
        if (typeof g.label !== 'string') report.error('missing', `${at}.label is required`, at);
        if (!Array.isArray(g.entities) || !g.entities.length) { report.error('missing', `${at}.entities must be non-empty`, at); return; }
        g.entities.forEach((id) => {
          if (!entityIds.has(id)) report.error('dangling-ref', `${at} references unknown entity "${id}"${listIds(entityIds)}`, at);
          if (membership.has(id)) report.error('multi-group', `entity "${id}" is in groups "${membership.get(id)}" and "${g.id}"; one group per entity`, at);
          membership.set(id, g.id);
        });
      });
    }
  }
  const rels = spec.relationships || [];
  if (!Array.isArray(rels)) report.error('type', 'relationships must be an array', 'relationships');
  else {
    const relIds = new Set();
    rels.forEach((r, i) => {
      const at = `relationships[${i}]`;
      if (!isObj(r)) { report.error('type', `${at} must be an object`, at); return; }
      if (r.id !== undefined) {
        if (!ID_RE.test(String(r.id))) report.error('id', `${at}.id is invalid`, at);
        else if (relIds.has(r.id)) report.error('duplicate-id', `${at}.id "${r.id}" duplicated`, at);
        relIds.add(r.id);
      }
      for (const end of ['from', 'to']) {
        if (!entityIds.has(r[end])) report.error('dangling-ref', `${at}.${end} "${r[end]}" is not an entity id${listIds(entityIds)}`, at);
      }
      checkEnum(report, r.from_cardinality, ENUMS.erd.cardinality, `${at}.from_cardinality`);
      checkEnum(report, r.to_cardinality, ENUMS.erd.cardinality, `${at}.to_cardinality`);
      checkEnum(report, r.on_delete, ENUMS.erd.onDelete, `${at}.on_delete`);
      const fromEntity = spec.entities.find((e) => e.id === r.from);
      if (fromEntity && r.from_column && !(fromEntity.columns || []).some((c) => c.name === r.from_column)) {
        report.warn('unknown-column', `${at}.from_column "${r.from_column}" is not a column of "${r.from}"`, at);
      }
      const toEntity = spec.entities.find((e) => e.id === r.to);
      if (toEntity && r.to_column && !(toEntity.columns || []).some((c) => c.name === r.to_column)) {
        report.warn('unknown-column', `${at}.to_column "${r.to_column}" is not a column of "${r.to}"`, at);
      }
    });
  }
  if (spec.entities.length > 25) report.warn('size', `${spec.entities.length} entities in one ERD is hard to read; split by group into several diagrams`, 'entities');
  return report;
}

export function validateC4(spec, report = new Report()) {
  checkCommon(report, spec);
  if (isObj(spec.meta)) checkEnum(report, spec.meta.level, ENUMS.c4.level, 'meta.level');
  checkLayout(report, spec.layout, { direction: 'enum', gapX: 'number', gapY: 'number' });
  if (isObj(spec.layout)) checkEnum(report, spec.layout.direction, ['tb', 'lr'], 'layout.direction');
  if (!Array.isArray(spec.elements) || !spec.elements.length) { report.error('missing', 'elements must be a non-empty array', 'elements'); return report; }
  const elementIds = checkIds(report, spec.elements, 'elements');
  checkCells(report, spec.elements, 'elements');
  spec.elements.forEach((e, i) => {
    const at = `elements[${i}]`;
    if (!isObj(e)) { report.error('type', `${at} must be an object`, at); return; }
    checkEnum(report, e.kind, ENUMS.c4.elementKind, `${at}.kind`, false);
    if (e.link !== undefined && (typeof e.link !== 'string' || !isSafeLink(e.link))) report.error('url', `${at}.link must be a relative path or an http(s) URL`, at);
    if (typeof e.label !== 'string' || !e.label) report.error('missing', `${at}.label is required`, at);
    if (!e.description && e.kind !== 'person') report.warn('description', `${at} (${e.label}) has no description; C4 boxes should say what the thing does`, at);
    checkSources(report, e.sources, `${at}.sources`);
  });
  const boundaryIds = new Set();
  if (spec.boundaries !== undefined) {
    if (!Array.isArray(spec.boundaries)) report.error('type', 'boundaries must be an array', 'boundaries');
    else {
      for (const id of checkIds(report, spec.boundaries, 'boundaries')) {
        if (elementIds.has(id)) report.error('id-clash', `boundary id "${id}" clashes with an element id`, 'boundaries');
        boundaryIds.add(id);
      }
      const parentOf = new Map();
      spec.boundaries.forEach((b, i) => {
        const at = `boundaries[${i}]`;
        if (!isObj(b)) { report.error('type', `${at} must be an object`, at); return; }
        checkEnum(report, b.kind, ENUMS.c4.boundaryKind, `${at}.kind`);
        if (typeof b.label !== 'string') report.error('missing', `${at}.label is required`, at);
        if (!Array.isArray(b.contains) || !b.contains.length) { report.error('missing', `${at}.contains must be non-empty`, at); return; }
        b.contains.forEach((id) => {
          if (!elementIds.has(id) && !boundaryIds.has(id)) report.error('dangling-ref', `${at} contains unknown id "${id}"${listIds(elementIds)}`, at);
          if (id === b.id) report.error('self-contain', `${at} contains itself`, at);
          if (parentOf.has(id)) report.error('multi-parent', `"${id}" is inside both "${parentOf.get(id)}" and "${b.id}"`, at);
          parentOf.set(id, b.id);
        });
      });
      // Cycle check across nested boundaries.
      for (const b of spec.boundaries) {
        let cur = parentOf.get(b.id); const seen = new Set([b.id]);
        while (cur) {
          if (seen.has(cur)) { report.error('cycle', `boundary nesting cycle through "${b.id}"`, 'boundaries'); break; }
          seen.add(cur); cur = parentOf.get(cur);
        }
      }
    }
  }
  const rels = spec.relationships || [];
  if (!Array.isArray(rels)) report.error('type', 'relationships must be an array', 'relationships');
  else {
    const relIds = new Set();
    rels.forEach((r, i) => {
      const at = `relationships[${i}]`;
      if (!isObj(r)) { report.error('type', `${at} must be an object`, at); return; }
      if (r.id !== undefined) {
        if (!ID_RE.test(String(r.id))) report.error('id', `${at}.id is invalid`, at);
        else if (relIds.has(r.id)) report.error('duplicate-id', `${at}.id "${r.id}" duplicated`, at);
        relIds.add(r.id);
      }
      for (const end of ['from', 'to']) {
        if (!elementIds.has(r[end])) report.error('dangling-ref', `${at}.${end} "${r[end]}" is not an element id${listIds(elementIds)}`, at);
      }
      if (!r.label) report.warn('label', `${at} (${r.from} -> ${r.to}) has no label; C4 arrows should say what flows`, at);
      checkEnum(report, r.direction, ENUMS.c4.direction, `${at}.direction`);
      checkEnum(report, r.style, ENUMS.c4.style, `${at}.style`);
    });
  }
  if (spec.elements.length > 20) report.warn('size', `${spec.elements.length} elements; a C4 diagram reads best under ~15. Zoom in with another level instead.`, 'elements');
  return report;
}

export function validateEndpoints(spec, report = new Report()) {
  checkCommon(report, spec);
  if (isObj(spec.meta)) checkEnum(report, spec.meta.api_kind, ENUMS.endpoints.apiKind, 'meta.api_kind');
  checkLayout(report, spec.layout, { columns: 'integer', card_width: 'number', show_types: 'boolean' });
  if (!Array.isArray(spec.endpoints) || !spec.endpoints.length) { report.error('missing', 'endpoints must be a non-empty array', 'endpoints'); return report; }
  const groupIds = new Set();
  if (spec.groups !== undefined) {
    if (!Array.isArray(spec.groups)) report.error('type', 'groups must be an array', 'groups');
    else {
      for (const id of checkIds(report, spec.groups, 'groups')) groupIds.add(id);
      spec.groups.forEach((g, i) => {
        if (!isObj(g)) { report.error('type', `groups[${i}] must be an object`, `groups[${i}]`); return; }
        if (typeof g.label !== 'string') report.error('missing', `groups[${i}].label is required`, `groups[${i}]`);
        checkSources(report, g.sources, `groups[${i}].sources`);
      });
    }
  }
  const typeIds = new Set();
  if (spec.types !== undefined) {
    if (!Array.isArray(spec.types)) report.error('type', 'types must be an array', 'types');
    else {
      for (const id of checkIds(report, spec.types, 'types')) {
        if (groupIds.has(id)) report.error('id-clash', `type id "${id}" clashes with a group id`, 'types');
        typeIds.add(id);
      }
      spec.types.forEach((t, i) => {
        const at = `types[${i}]`;
        if (!isObj(t)) { report.error('type', `${at} must be an object`, at); return; }
        if (typeof t.name !== 'string') report.error('missing', `${at}.name is required`, at);
        checkEnum(report, t.kind, ENUMS.endpoints.typeKind, `${at}.kind`);
        checkSources(report, t.sources, `${at}.sources`);
        (t.fields || []).forEach((f, j) => {
          if (!isObj(f) || typeof f.name !== 'string') report.error('missing', `${at}.fields[${j}].name is required`, at);
        });
      });
    }
  }
  const endpointIds = checkIds(report, spec.endpoints, 'endpoints');
  for (const id of endpointIds) {
    if (groupIds.has(id) || typeIds.has(id)) report.error('id-clash', `endpoint id "${id}" clashes with a group or type id`, 'endpoints');
  }
  const seenRoutes = new Set();
  spec.endpoints.forEach((e, i) => {
    const at = `endpoints[${i}]`;
    if (!isObj(e)) { report.error('type', `${at} must be an object`, at); return; }
    checkEnum(report, e.method, ENUMS.endpoints.method, `${at}.method`, false);
    if (typeof e.path !== 'string' || !e.path) report.error('missing', `${at}.path is required`, at);
    if (e.group !== undefined && !groupIds.has(e.group)) report.error('dangling-ref', `${at}.group "${e.group}" is not a group id${listIds(groupIds)}`, at);
    if (e.status !== undefined && (!Array.isArray(e.status) || !e.status.every((c) => Number.isInteger(c) || typeof c === 'string'))) {
      report.error('type', `${at}.status must be an array of status codes (got ${JSON.stringify(e.status)})`, at);
    }
    if (e.entities !== undefined && (!Array.isArray(e.entities) || !e.entities.every((x) => typeof x === 'string'))) report.error('type', `${at}.entities must be an array of entity ids`, at);
    checkSources(report, e.sources, `${at}.sources`);
    (e.params || []).forEach((p, j) => {
      if (!isObj(p) || typeof p.name !== 'string') report.error('missing', `${at}.params[${j}].name is required`, at);
      else checkEnum(report, p.in, ENUMS.endpoints.paramIn, `${at}.params[${j}].in`);
    });
    const routeKey = `${e.method} ${e.path}`;
    if (seenRoutes.has(routeKey)) report.warn('duplicate-route', `${routeKey} appears more than once`, at);
    seenRoutes.add(routeKey);
    if (!e.summary) report.warn('summary', `${at} (${routeKey}) has no summary`, at);
  });
  if (spec.endpoints.length > 80) report.warn('size', `${spec.endpoints.length} endpoints; consider one diagram per bounded context`, 'endpoints');
  return report;
}

export function validateLifecycle(spec, report = new Report()) {
  checkCommon(report, spec);
  if (isObj(spec.meta) && spec.meta.subject !== undefined && typeof spec.meta.subject !== 'string') report.error('type', 'meta.subject must be a string', 'meta.subject');
  checkLayout(report, spec.layout, { direction: 'enum', gapX: 'number', gapY: 'number' });
  if (isObj(spec.layout)) checkEnum(report, spec.layout.direction, ['lr', 'tb'], 'layout.direction');
  if (!Array.isArray(spec.states) || !spec.states.length) { report.error('missing', 'states must be a non-empty array', 'states'); return report; }
  const stateIds = checkIds(report, spec.states, 'states');
  checkCells(report, spec.states, 'states');
  spec.states.forEach((s, i) => {
    const at = `states[${i}]`;
    if (!isObj(s)) { report.error('type', `${at} must be an object`, at); return; }
    if (typeof s.label !== 'string' || !s.label) report.error('missing', `${at}.label is required`, at);
    checkEnum(report, s.kind, ENUMS.lifecycle.stateKind, `${at}.kind`);
    checkSources(report, s.sources, `${at}.sources`);
  });
  const transitions = spec.transitions || [];
  if (!Array.isArray(transitions)) { report.error('type', 'transitions must be an array', 'transitions'); return report; }
  const outgoing = new Map([...stateIds].map((id) => [id, 0]));
  const incoming = new Map([...stateIds].map((id) => [id, 0]));
  const adj = new Map([...stateIds].map((id) => [id, []]));
  const relIds = new Set();
  transitions.forEach((t, i) => {
    const at = `transitions[${i}]`;
    if (!isObj(t)) { report.error('type', `${at} must be an object`, at); return; }
    if (t.id !== undefined) {
      if (!ID_RE.test(String(t.id))) report.error('id', `${at}.id is invalid`, at);
      else if (relIds.has(t.id)) report.error('duplicate-id', `${at}.id "${t.id}" duplicated`, at);
      relIds.add(t.id);
    }
    let ok = true;
    for (const end of ['from', 'to']) {
      if (!stateIds.has(t[end])) { report.error('dangling-ref', `${at}.${end} "${t[end]}" is not a state id`, at); ok = false; }
    }
    checkEnum(report, t.kind, ENUMS.lifecycle.transitionKind, `${at}.kind`);
    if (!t.event && !t.label) report.warn('event', `${at} (${t.from} -> ${t.to}) has no event; say what triggers it`, at);
    checkSources(report, t.sources, `${at}.sources`);
    if (ok) {
      outgoing.set(t.from, outgoing.get(t.from) + 1);
      incoming.set(t.to, incoming.get(t.to) + 1);
      if (t.from !== t.to) adj.get(t.from).push(t.to);
    }
  });
  const initial = spec.states.filter((s) => isObj(s) && s.kind === 'initial');
  if (!initial.length) report.warn('initial', 'no state has kind "initial"; the diagram will start from states with no incoming transitions', 'states');
  if (initial.length > 1) report.warn('initial', `${initial.length} initial states; usually there is one`, 'states');
  const roots = (initial.length ? initial : spec.states.filter((s) => isObj(s) && incoming.get(s.id) === 0)).map((s) => s.id);
  const reachable = new Set(roots);
  const queue = [...roots];
  while (queue.length) { const id = queue.shift(); for (const n of adj.get(id) || []) if (!reachable.has(n)) { reachable.add(n); queue.push(n); } }
  for (const s of spec.states) {
    if (!isObj(s) || !stateIds.has(s.id)) continue;
    if (!reachable.has(s.id) && transitions.length) report.warn('unreachable', `state "${s.id}" cannot be reached from the initial state`, 'states');
    if (s.kind === 'terminal' && outgoing.get(s.id) > 0) report.warn('terminal-exit', `terminal state "${s.id}" has ${outgoing.get(s.id)} outgoing transition(s); use kind "failure" or "normal" if it is recoverable`, 'states');
    if (s.kind !== 'terminal' && outgoing.get(s.id) === 0 && transitions.length) report.warn('dead-end', `state "${s.id}" has no way out; mark it terminal or add a transition`, 'states');
  }
  if (spec.states.length > 20) report.warn('size', `${spec.states.length} states; split by subject or phase`, 'states');
  return report;
}

const REF_RE = /^[a-zA-Z][a-zA-Z0-9_.-]*(#[a-zA-Z][a-zA-Z0-9_.-]*)?$/;
const HASH_RE = /^[0-9a-f]{12}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Hedges, instructions, and history are not claims about what the system IS.
const NOT_A_CLAIM = /\b(should|probably|might|maybe|we used to|will be|TODO|TBD)\b/i;

function checkClaimSource(report, src, at) {
  if (!isObj(src)) { report.error('missing', `${at}.source is required`, at); return; }
  if (src.kind === 'derived') {
    report.error('derived-authored', `${at}.source.kind is "derived"; derived facts are computed from a spec, never written by hand`, at);
    return;
  }
  checkEnum(report, src.kind, ENUMS.docs.sourceKind, `${at}.source.kind`, false);

  if (src.kind === 'anchored') {
    if (typeof src.path !== 'string' || !src.path) report.error('missing', `${at}.source.path is required`, at);
    else if (src.path.startsWith('/') || src.path.startsWith('\\') || SCHEME_RE.test(src.path) || src.path.split(/[\\/]/).some((seg) => seg === '..')) {
      report.error('path', `${at}.source.path must be repo-relative (no leading slash, drive letter, scheme, or ".." segment)`, at);
    }
    if (typeof src.hash !== 'string' || !HASH_RE.test(src.hash)) {
      report.error('hash', `${at}.source.hash must be 12 lowercase hex characters; run "vibex docs --reanchor" to compute it`, at);
    }
    for (const k of ['line', 'end_line']) {
      if (src[k] !== undefined && (!Number.isInteger(src[k]) || src[k] < 1)) report.error('range', `${at}.source.${k} must be an integer >= 1`, at);
    }
    if (Number.isInteger(src.line) && Number.isInteger(src.end_line) && src.end_line < src.line) {
      report.error('range', `${at}.source.end_line is before line`, at);
    }
    if (src.hash_mode !== undefined) checkEnum(report, src.hash_mode, ENUMS.docs.hashMode, `${at}.source.hash_mode`, false);
    if (src.hash_mode === 'loose' && isWhitespaceSignificant(src.path)) {
      report.warn('loose-hash', `${at}.source.hash_mode is "loose" on ${src.path}, where indentation is syntax: re-nesting a line will not flag this claim. Drop the override unless the anchored lines cannot change meaning by indentation.`, at);
    }
  } else if (src.kind === 'asserted') {
    if (typeof src.by !== 'string' || !src.by.trim()) report.error('missing', `${at}.source.by is required: name who stands behind this`, at);
    if (typeof src.at !== 'string' || !DATE_RE.test(src.at)) report.error('date', `${at}.source.at must be an ISO date (YYYY-MM-DD) saying when this was last confirmed true`, at);
    else if (Number.isNaN(Date.parse(src.at))) report.error('date', `${at}.source.at is not a real date`, at);
  }
}

function validateDocs(spec, report) {
  checkCommon(report, spec);
  if (!Array.isArray(spec.sections) || !spec.sections.length) {
    report.error('missing', 'sections is required and must list at least one section', 'sections');
    return report;
  }
  const claims = Array.isArray(spec.claims) ? spec.claims : [];
  if (spec.claims !== undefined && !Array.isArray(spec.claims)) report.error('type', 'claims must be an array', 'claims');

  const claimIds = checkIds(report, claims, 'claims');
  const sectionIds = checkIds(report, spec.sections, 'sections');

  claims.forEach((c, i) => {
    const at = `claims[${i}]`;
    if (!isObj(c)) { report.error('type', `${at} must be an object`, at); return; }
    if (typeof c.text !== 'string' || !c.text.trim()) report.error('missing', `${at}.text is required`, at);
    else {
      if (c.text.length > 300) report.warn('length', `${at}.text is ${c.text.length} characters; a claim is one sentence — split it`, at);
      if (NOT_A_CLAIM.test(c.text)) report.warn('not-a-claim', `${at}.text hedges or instructs ("${c.text.match(NOT_A_CLAIM)[0]}"); state what is true, or move it to source.rationale`, at);
      // ", and" or a semicolon almost always joins two independent clauses.
      if (/,\s+and\b|;\s/.test(c.text)) {
        report.warn('compound', `${at}.text reads as more than one assertion; one claim = one fact, so it can be checked, cited and retracted on its own`, at);
      }
    }
    // A claim may not rate itself: confidence is computed from evidence.
    if (c.confidence !== undefined) report.error('confidence-authored', `${at}.confidence is computed by the build from source and freshness; remove it`, at);
    checkClaimSource(report, c.source, at);
    if (spec.meta?.proposed && c.source?.kind === 'anchored') {
      report.error('anchored-proposal', `${at} is anchored to code, but this document is marked proposed — there is nothing to anchor a proposal to. State it and say who is proposing it.`, at);
    }
    if (c.subject !== undefined && (typeof c.subject !== 'string' || !REF_RE.test(c.subject))) {
      report.error('ref', `${at}.subject must look like "spec-id" or "spec-id#node-id" (got ${JSON.stringify(c.subject)})`, at);
    }
    if (c.supersedes !== undefined && !claimIds.has(c.supersedes)) {
      report.error('dangling-ref', `${at}.supersedes "${c.supersedes}" is not a claim in this document`, at);
    }
    if (c.supersedes === c.id) report.error('ref', `${at}.supersedes points at itself`, at);
  });

  const placed = new Set();
  spec.sections.forEach((s, i) => {
    const at = `sections[${i}]`;
    if (!isObj(s)) { report.error('type', `${at} must be an object`, at); return; }
    if (typeof s.title !== 'string' || !s.title.trim()) report.error('missing', `${at}.title is required`, at);
    for (const id of s.claims || []) {
      if (!claimIds.has(id)) report.error('dangling-ref', `${at}.claims references unknown claim "${id}"`, at);
      else placed.add(id);
    }
    (s.generate || []).forEach((g, k) => checkEnum(report, g, ENUMS.docs.generator, `${at}.generate[${k}]`, false));

    if (s.narrative !== undefined) {
      if (typeof s.narrative !== 'string') { report.error('type', `${at}.narrative must be a string of Markdown`, at); return; }
      const cited = [...s.narrative.matchAll(/\[\[([a-zA-Z][a-zA-Z0-9_.-]*)\]\]/g)].map((m) => m[1]);
      for (const id of cited) {
        if (claimIds.has(id)) placed.add(id);
        else report.error('dangling-ref', `${at}.narrative cites unknown claim "${id}"`, at);
      }
      // Prose with no citations is an opinion piece sitting inside a document
      // whose whole point is that every statement is traceable.
      if (!cited.length && s.narrative.trim().length > 200) {
        report.warn('uncited-narrative', `${at}.narrative is ${s.narrative.trim().length} characters and cites no claim; load-bearing statements belong in claims the prose cites`, at);
      }
    }
  });

  for (const c of claims) {
    if (isObj(c) && claimIds.has(c.id) && !placed.has(c.id) && !c.subject) {
      report.warn('unplaced', `claim "${c.id}" is in no section and has no subject, so nothing will render it`, 'claims');
    }
  }

  const covers = spec.covers;
  if (covers !== undefined) {
    if (!Array.isArray(covers)) report.error('type', 'covers must be an array of spec ids', 'covers');
    else {
      const known = new Set(covers);
      for (const c of claims) {
        if (!isObj(c) || typeof c.subject !== 'string') continue;
        const specId = c.subject.split('#')[0];
        if (!known.has(specId)) report.warn('uncovered-subject', `claim "${c.id}" is about "${specId}", which is not in covers; its subject cannot be resolved`, 'covers');
      }
    }
  }

  if (spec.review_window_days !== undefined && (!Number.isInteger(spec.review_window_days) || spec.review_window_days < 1)) {
    report.error('range', 'review_window_days must be an integer >= 1', 'review_window_days');
  }

  (spec.glossary || []).forEach((g, i) => {
    const at = `glossary[${i}]`;
    if (!isObj(g)) { report.error('type', `${at} must be an object`, at); return; }
    if (typeof g.term !== 'string' || !g.term.trim()) report.error('missing', `${at}.term is required`, at);
    if (typeof g.definition !== 'string' || !g.definition.trim()) report.error('missing', `${at}.definition is required`, at);
    if (g.see !== undefined && (typeof g.see !== 'string' || !REF_RE.test(g.see))) report.error('ref', `${at}.see must be a ref`, at);
  });

  const scope = spec.coverage?.out_of_scope;
  if (scope !== undefined && !Array.isArray(scope)) report.error('type', 'coverage.out_of_scope must be an array', 'coverage');
  else if (Array.isArray(scope)) {
    scope.forEach((o, i) => {
      const at = `coverage.out_of_scope[${i}]`;
      if (!isObj(o) || typeof o.area !== 'string' || !o.area.trim()) report.error('missing', `${at}.area is required`, at);
      if (!isObj(o) || typeof o.reason !== 'string' || !o.reason.trim()) report.error('missing', `${at}.reason is required: silence about a gap is what makes a document untrustworthy`, at);
    });
  }
  if (!scope || !scope.length) {
    report.warn('no-boundary', 'coverage.out_of_scope is empty; a document that does not say what it omits implies it covers everything', 'coverage');
  }
  if (!claims.length) report.warn('empty', 'no claims: this document will contain only derived facts', 'claims');
  if (sectionIds.size !== spec.sections.length) report.error('duplicate-id', 'section ids must be unique', 'sections');
  return report;
}

const VALIDATORS = { erd: validateErd, c4: validateC4, endpoints: validateEndpoints, lifecycle: validateLifecycle, docs: validateDocs };

// Types that render to a diagram. `docs` is a spec but not a diagram.
export const DIAGRAM_TYPES = ['erd', 'c4', 'endpoints', 'lifecycle'];
export const SPEC_TYPES = Object.keys(VALIDATORS);

export function validateSpec(spec) {
  const report = new Report();
  if (!isObj(spec)) { report.error('type', 'spec must be a JSON object', ''); return report; }
  const type = spec.diagram_type;
  if (!VALIDATORS[type]) {
    report.error('diagram_type', `diagram_type must be one of ${SPEC_TYPES.join(', ')} (got ${JSON.stringify(type)})`, 'diagram_type');
    return report;
  }
  try {
    return VALIDATORS[type](spec, report);
  } catch (e) {
    // Malformed input the checks above did not anticipate: report it instead
    // of letting a stack trace escape to the CLI.
    report.error('internal', `spec could not be validated: ${e.message}`, '');
    return report;
  }
}

export function formatReport(report) {
  const lines = [];
  for (const e of report.errors) lines.push(`error   ${e.code.padEnd(16)} ${e.message}`);
  for (const w of report.warnings) lines.push(`warning ${w.code.padEnd(16)} ${w.message}`);
  lines.push(`${report.errors.length} error(s), ${report.warnings.length} warning(s)`);
  return lines.join('\n');
}
