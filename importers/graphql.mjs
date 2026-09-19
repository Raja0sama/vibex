// Minimal GraphQL SDL parser → endpoints spec (operations) or ERD (object types).
// Tolerant: skips directives, ignores what it does not understand.
import { slug, uniqueId, firstSentence } from './shared.mjs';

const PUNCT = new Set(['{', '}', '(', ')', '[', ']', ':', '!', '=', '|', '&', '@']);

export function tokenize(src) {
  const tokens = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === '#') { while (i < n && src[i] !== '\n') i += 1; continue; }
    if (/\s|,/.test(ch)) { i += 1; continue; }
    if (src.startsWith('"""', i)) {
      const end = src.indexOf('"""', i + 3);
      const raw = end === -1 ? src.slice(i + 3) : src.slice(i + 3, end);
      tokens.push({ t: 'str', v: raw.split('\n').map((l) => l.trim()).join(' ').trim() });
      i = end === -1 ? n : end + 3; continue;
    }
    if (ch === '"') {
      let j = i + 1; let out = '';
      while (j < n && src[j] !== '"') { if (src[j] === '\\') { out += src[j + 1]; j += 2; } else { out += src[j]; j += 1; } }
      tokens.push({ t: 'str', v: out }); i = j + 1; continue;
    }
    if (PUNCT.has(ch)) { tokens.push({ t: 'p', v: ch }); i += 1; continue; }
    const m = /^[A-Za-z_][A-Za-z0-9_]*|^-?\d+(\.\d+)?/.exec(src.slice(i));
    if (m) { tokens.push({ t: 'name', v: m[0] }); i += m[0].length; continue; }
    i += 1; // unknown char
  }
  return tokens;
}

export function parseSdl(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = (o = 0) => toks[p + o];
  const next = () => toks[p++];
  const is = (v, o = 0) => peek(o) && peek(o).t === 'p' && peek(o).v === v;

  function skipDirectives() {
    while (is('@')) {
      next(); next(); // @ name
      if (is('(')) skipBalanced('(', ')');
    }
  }
  function skipBalanced(open, close) {
    let depth = 0;
    do {
      const tk = next();
      if (!tk) return;
      if (tk.t === 'p' && tk.v === open) depth += 1;
      if (tk.t === 'p' && tk.v === close) depth -= 1;
    } while (depth > 0);
  }
  function parseType() {
    let s = '';
    if (is('[')) { next(); s = `[${parseType()}`; if (is(']')) next(); s += ']'; }
    else { const tk = next(); s = tk ? tk.v : ''; }
    if (is('!')) { next(); s += '!'; }
    return s;
  }
  function skipValue() {
    if (is('[')) return skipBalanced('[', ']');
    if (is('{')) return skipBalanced('{', '}');
    next();
  }
  function parseArgs() {
    const args = [];
    if (!is('(')) return args;
    next();
    while (peek() && !is(')')) {
      let description;
      if (peek().t === 'str') description = next().v;
      const name = next()?.v;
      if (is(':')) next();
      const type = parseType();
      let def;
      if (is('=')) { next(); const start = p; skipValue(); def = toks.slice(start, p).map((t) => t.v).join(''); }
      skipDirectives();
      args.push({ name, type, ...(def !== undefined ? { default: def } : {}), ...(description ? { description } : {}) });
    }
    if (is(')')) next();
    return args;
  }
  function parseFields(withArgs) {
    const fields = [];
    if (!is('{')) return fields;
    next();
    while (peek() && !is('}')) {
      let description;
      if (peek().t === 'str') description = next().v;
      const name = next()?.v;
      if (name === undefined) break;
      const args = withArgs ? parseArgs() : [];
      let type = '';
      if (is(':')) { next(); type = parseType(); }
      skipDirectives();
      fields.push({ name, type, ...(args.length ? { args } : {}), ...(description ? { description } : {}) });
    }
    if (is('}')) next();
    return fields;
  }

  const defs = [];
  const schemaDef = {};
  while (p < toks.length) {
    let description;
    if (peek().t === 'str') description = next().v;
    let tk = next();
    if (!tk) break;
    let extend = false;
    if (tk.v === 'extend') { extend = true; tk = next(); if (!tk) break; }
    const line = null;
    // `extend type X` adds to an existing definition instead of replacing it.
    const define = (def) => {
      const existing = extend ? defs.find((d) => d.name === def.name && d.kind === def.kind) : null;
      if (!existing) { defs.push(def); return; }
      for (const key of ['fields', 'values', 'members', 'implements']) {
        if (Array.isArray(def[key]) && def[key].length) existing[key] = [...(existing[key] || []), ...def[key]];
      }
      if (def.description && !existing.description) existing.description = def.description;
    };
    switch (tk.v) {
      case 'schema': {
        skipDirectives();
        for (const f of parseFields(false)) schemaDef[f.name] = f.type.replace(/[![\]]/g, '');
        break;
      }
      case 'type': case 'interface': case 'input': {
        const name = next().v;
        const implementsList = [];
        if (peek() && peek().v === 'implements') { next(); if (is('&')) next(); if (peek()?.t === 'name') implementsList.push(next().v); while (is('&')) { next(); if (peek()?.t === 'name') implementsList.push(next().v); } }
        skipDirectives();
        const fields = parseFields(tk.v !== 'input');
        define({ kind: tk.v === 'type' ? 'object' : tk.v, name, fields, ...(implementsList.length ? { implements: implementsList } : {}), ...(description ? { description } : {}), line });
        break;
      }
      case 'enum': {
        const name = next().v; skipDirectives();
        const values = [];
        if (is('{')) { next(); while (peek() && !is('}')) { if (peek().t === 'str') next(); const v = next(); if (v.t === 'name') values.push(v.v); skipDirectives(); } next(); }
        define({ kind: 'enum', name, values, ...(description ? { description } : {}) });
        break;
      }
      case 'union': {
        const name = next().v; skipDirectives();
        const members = [];
        if (is('=')) { next(); if (is('|')) next(); if (peek()?.t === 'name') members.push(next().v); while (is('|')) { next(); if (peek()?.t === 'name') members.push(next().v); } }
        define({ kind: 'union', name, members, ...(description ? { description } : {}) });
        break;
      }
      case 'scalar': { const name = next().v; skipDirectives(); defs.push({ kind: 'scalar', name, ...(description ? { description } : {}) }); break; }
      case 'directive': { next(); next(); if (is('(')) skipBalanced('(', ')'); while (peek() && peek().v !== 'on') next(); next(); while (peek() && (peek().t === 'name' || is('|'))) next(); break; }
      default: break;
    }
  }
  return { defs, roots: { query: schemaDef.query || 'Query', mutation: schemaDef.mutation || 'Mutation', subscription: schemaDef.subscription || 'Subscription' } };
}

export function baseType(type) { return String(type || '').replace(/[![\]]/g, ''); }
const isList = (type) => String(type || '').includes('[');
const isRequired = (type) => String(type || '').endsWith('!');

export function importGraphql(src, { title, erd = false, sourcePath } = {}) {
  const { defs, roots } = parseSdl(src);
  return erd ? graphqlToErd(defs, roots, { title, sourcePath }) : graphqlToEndpoints(defs, roots, { title, sourcePath });
}

function graphqlToEndpoints(defs, roots, { title, sourcePath }) {
  const byName = new Map(defs.map((d) => [d.name, d]));
  const rootKinds = [['query', 'QUERY', 'Queries'], ['mutation', 'MUTATION', 'Mutations'], ['subscription', 'SUBSCRIPTION', 'Subscriptions']];
  const groups = [];
  const endpoints = [];
  const taken = new Set();
  const referenced = new Set();
  for (const [key, method, label] of rootKinds) {
    const root = byName.get(roots[key]);
    if (!root || !root.fields.length) continue;
    const gid = uniqueId(key === 'query' ? 'queries' : `${key}s`, taken);
    groups.push({ id: gid, label });
    for (const f of root.fields) {
      const args = f.args || [];
      const sig = args.length ? `${f.name}(${args.map((a) => `${a.name}: ${a.type}`).join(', ')})` : f.name;
      referenced.add(baseType(f.type));
      for (const a of args) referenced.add(baseType(a.type));
      endpoints.push({
        id: uniqueId(slug(`${key}-${f.name}`), taken),
        group: gid,
        method,
        path: sig,
        ...(f.description ? { summary: firstSentence(f.description) } : {}),
        response: f.type,
        ...(args.length ? { params: args.map((a) => ({ name: a.name, in: 'arg', type: a.type, ...(isRequired(a.type) ? { required: true } : {}) })) } : {}),
      });
    }
  }
  const SCALARS = new Set(['ID', 'String', 'Int', 'Float', 'Boolean']);
  const queue = [...referenced];
  while (queue.length) {
    const name = queue.shift();
    const d = byName.get(name);
    if (!d) continue;
    for (const f of d.fields || []) { const b = baseType(f.type); if (!referenced.has(b)) { referenced.add(b); queue.push(b); } for (const a of f.args || []) { const ab = baseType(a.type); if (!referenced.has(ab)) { referenced.add(ab); queue.push(ab); } } }
    for (const m of d.members || []) if (!referenced.has(m)) { referenced.add(m); queue.push(m); }
  }
  const typeIds = new Set();
  const rootNames = new Set(Object.values(roots));
  const types = defs
    .filter((d) => referenced.has(d.name) && !rootNames.has(d.name) && !SCALARS.has(d.name))
    .map((d) => ({
      id: uniqueId(slug(d.name, 'type'), typeIds),
      name: d.name,
      kind: d.kind,
      ...(d.description ? { description: firstSentence(d.description, 160) } : {}),
      ...(d.kind === 'enum' ? { values: d.values } : d.kind === 'union' ? { fields: d.members.map((m) => ({ name: m, type: m })) } : { fields: (d.fields || []).map((f) => ({ name: f.name, type: f.type.replace(/!$/, ''), ...(isRequired(f.type) ? { required: true } : {}), ...(f.description ? { description: firstSentence(f.description, 100) } : {}) })) }),
    }));
  return {
    schema_version: 1,
    diagram_type: 'endpoints',
    meta: { title: title || 'GraphQL API', api_kind: 'graphql' },
    groups,
    endpoints,
    ...(types.length ? { types } : {}),
    ...(sourcePath ? { cards: [{ title: 'Source', tone: 'info', items: [`Imported from ${sourcePath}`, `${endpoints.length} operations, ${types.length} types shown`] }] } : {}),
  };
}

function graphqlToErd(defs, roots, { title, sourcePath }) {
  const rootNames = new Set(Object.values(roots));
  // Skip pagination wrappers; they are API shape, not data model.
  const isWrapper = (name) => /(Connection|Edge|PageInfo|Payload|Result|Response)$/.test(name);
  const objects = defs.filter((d) => d.kind === 'object' && !rootNames.has(d.name) && (d.fields || []).length && !isWrapper(d.name));
  const enums = defs.filter((d) => d.kind === 'enum');
  const objectNames = new Set(objects.map((o) => o.name));
  const enumNames = new Set(enums.map((e) => e.name));
  const idOf = (name) => slug(name).toLowerCase();
  const entities = objects.map((o) => ({
    id: idOf(o.name),
    name: o.name,
    kind: 'table',
    ...(o.description ? { description: firstSentence(o.description, 160) } : {}),
    columns: (o.fields || []).filter((f) => !objectNames.has(baseType(f.type))).map((f) => ({
      name: f.name,
      type: `${baseType(f.type)}${isList(f.type) ? '[]' : ''}`,
      ...(f.name === 'id' ? { pk: true } : {}),
      ...(!isRequired(f.type) ? { nullable: true } : {}),
    })),
  }));
  for (const e of enums) entities.push({ id: idOf(e.name), name: e.name, kind: 'enum', values: e.values });
  // Relationships from object-typed fields. Pair up back-references.
  const edges = [];
  for (const o of objects) for (const f of o.fields || []) {
    const target = baseType(f.type);
    if (!objectNames.has(target)) continue;
    edges.push({ from: o.name, to: target, field: f.name, list: isList(f.type), required: isRequired(f.type) });
  }
  const relationships = [];
  const done = new Set();
  edges.forEach((e, i) => {
    if (done.has(i)) return;
    const backIndex = edges.findIndex((b, j) => j !== i && b.from === e.to && b.to === e.from && !done.has(j));
    const back = backIndex >= 0 ? edges[backIndex] : null;
    if (back) done.add(backIndex);
    done.add(i);
    // Child = the side holding a single reference; parent = the side holding the list.
    let child = e; let parent = back;
    if (e.list && back && !back.list) { child = back; parent = e; }
    if (e.list && !back) { child = { from: e.to, to: e.from, field: undefined, list: false, required: true }; parent = e; }
    relationships.push({
      id: slug(`${child.from}-${child.to}-${child.field || parent?.field || 'ref'}`).toLowerCase(),
      from: idOf(child.from),
      to: idOf(child.to),
      from_cardinality: parent ? (parent.list ? 'many' : (parent.required ? 'one' : 'zero-or-one')) : 'many',
      to_cardinality: child.required ? 'one' : 'zero-or-one',
      ...(child.field ? { label: child.field } : parent?.field ? { label: parent.field } : {}),
    });
  });
  return {
    schema_version: 1,
    diagram_type: 'erd',
    meta: { title: title || 'GraphQL types', subtitle: 'Derived from object types; cardinalities inferred from list/non-null' },
    entities,
    relationships,
    ...(sourcePath ? { cards: [{ title: 'Source', tone: 'info', items: [`Imported from ${sourcePath}`] }] } : {}),
  };
}
