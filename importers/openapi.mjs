// OpenAPI 3.x and Swagger 2.0 → endpoints spec.
import { slug, uniqueId, firstSentence } from './shared.mjs';

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

function refName(ref) { return String(ref).split('/').pop(); }

// Resolve a local JSON pointer such as "#/components/parameters/idParam".
export function resolveRef(doc, ref, depth = 0) {
  if (typeof ref !== 'string' || !ref.startsWith('#/') || depth > 8) return undefined;
  let cur = doc;
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!cur || typeof cur !== 'object' || !(key in cur)) return undefined;
    cur = cur[key];
  }
  return cur && typeof cur === 'object' && cur.$ref ? resolveRef(doc, cur.$ref, depth + 1) : cur;
}
// Parameters, request bodies and responses may be $ref objects; schemas keep
// their $ref because schemaName() turns it into the type name.
function deref(doc, obj) {
  return obj && typeof obj === 'object' && obj.$ref ? (resolveRef(doc, obj.$ref) || obj) : obj;
}

export function schemaName(schema, depth = 0) {
  if (!schema || depth > 4) return 'object';
  if (schema.$ref) return refName(schema.$ref);
  if (schema.type === 'array' || schema.items) return `${schemaName(schema.items, depth + 1)}[]`;
  for (const key of ['allOf', 'oneOf', 'anyOf']) {
    if (Array.isArray(schema[key]) && schema[key].length) {
      const joiner = key === 'allOf' ? ' & ' : ' | ';
      return schema[key].map((s) => schemaName(s, depth + 1)).join(joiner);
    }
  }
  if (schema.enum) return 'enum';
  if (schema.type) return schema.format ? `${schema.type}(${schema.format})` : schema.type;
  if (schema.properties) return 'object';
  return 'object';
}

function refsIn(schema, out = new Set(), depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 6) return out;
  if (schema.$ref) { out.add(refName(schema.$ref)); return out; }
  for (const v of Object.values(schema)) {
    if (Array.isArray(v)) v.forEach((x) => refsIn(x, out, depth + 1));
    else if (v && typeof v === 'object') refsIn(v, out, depth + 1);
  }
  return out;
}

function bodySchema(op, isV2, doc) {
  if (isV2) {
    const p = (op.parameters || []).map((x) => deref(doc, x)).find((x) => x && x.in === 'body');
    return p ? p.schema : null;
  }
  const content = deref(doc, op.requestBody)?.content || {};
  const first = Object.values(content)[0];
  return first?.schema || null;
}

function successSchema(op, isV2, doc) {
  const responses = op.responses || {};
  const codes = Object.keys(responses);
  const code = codes.find((c) => /^2\d\d$/.test(c)) || codes.find((c) => /^2XX$/i.test(c)) || codes.find((c) => c === 'default');
  if (!code) return { schema: null, status: [] };
  const res = deref(doc, responses[code]);
  if (isV2) return { schema: res?.schema || null };
  const content = res?.content || {};
  const first = Object.values(content)[0];
  return { schema: first?.schema || null };
}

function authOf(op, doc) {
  const security = op.security !== undefined ? op.security : doc.security;
  if (security === undefined) return undefined;
  if (!security.length) return 'none';
  const names = [];
  for (const requirement of security) for (const name of Object.keys(requirement)) if (!names.includes(name)) names.push(name);
  return names.join(' | ') || 'none';
}

export function importOpenApi(doc, { title, allTypes = false, sourcePath } = {}) {
  const isV2 = Boolean(doc.swagger);
  const schemas = isV2 ? (doc.definitions || {}) : (doc.components?.schemas || {});
  const taken = new Set();
  const groups = [];
  const groupIds = new Map();
  const ensureGroup = (tag) => {
    const key = tag || 'default';
    if (!groupIds.has(key)) {
      const id = uniqueId(slug(key, 'group'), taken);
      const declared = (doc.tags || []).find((t) => t.name === tag);
      groups.push({ id, label: tag || 'Other', ...(declared?.description ? { description: firstSentence(declared.description, 160) } : {}) });
      groupIds.set(key, id);
    }
    return groupIds.get(key);
  };

  const endpoints = [];
  const referenced = new Set();
  for (const [rawPath, pathItem] of Object.entries(doc.paths || {})) {
    if (!pathItem) continue;
    const pathParams = (pathItem.parameters || []).map((p) => deref(doc, p));
    for (const method of METHODS) {
      const op = pathItem[method];
      if (!op) continue;
      const tag = (op.tags || [])[0];
      const group = ensureGroup(tag);
      const id = uniqueId(slug(op.operationId || `${method}-${rawPath}`, 'op'), taken);
      const opParams = (op.parameters || []).map((p) => deref(doc, p));
      const params = [...pathParams, ...opParams]
        .filter((p) => p && typeof p.name === 'string' && p.in !== 'body')
        .map((p) => ({ name: p.name, in: p.in === 'formData' ? 'body' : p.in, type: schemaName(p.schema || p), ...(p.required ? { required: true } : {}) }));
      const reqSchema = bodySchema(op, isV2, doc);
      const { schema: resSchema } = successSchema(op, isV2, doc);
      refsIn(reqSchema, referenced); refsIn(resSchema, referenced);
      for (const p of [...pathParams, ...opParams]) refsIn(p, referenced);
      const status = Object.keys(op.responses || {}).filter((c) => /^\d{3}$/.test(c)).map(Number);
      const auth = authOf(op, doc);
      const ep = {
        id,
        group,
        method: method.toUpperCase(),
        path: rawPath,
        ...(op.summary || op.description ? { summary: firstSentence(op.summary || op.description) } : {}),
        ...(op.description && op.summary ? { description: op.description.trim() } : {}),
        ...(auth !== undefined ? { auth } : {}),
        ...(reqSchema ? { request: schemaName(reqSchema) } : {}),
        ...(resSchema ? { response: schemaName(resSchema) } : {}),
        ...(params.length ? { params } : {}),
        ...(status.length ? { status } : {}),
        ...(op.deprecated ? { deprecated: true } : {}),
        ...(op.tags && op.tags.length > 1 ? { tags: op.tags.slice(1) } : {}),
      };
      endpoints.push(ep);
    }
  }

  // Transitive closure of referenced schemas.
  const queue = [...referenced];
  while (queue.length) {
    const name = queue.shift();
    const schema = schemas[name];
    if (!schema) continue;
    for (const ref of refsIn(schema)) if (!referenced.has(ref)) { referenced.add(ref); queue.push(ref); }
  }
  const typeIds = new Set();
  const types = Object.entries(schemas)
    .filter(([name]) => allTypes || referenced.has(name))
    .map(([name, schema]) => {
      const id = uniqueId(slug(name, 'type'), typeIds);
      const required = new Set(schema.required || []);
      const props = schema.properties || (schema.allOf || []).reduce((acc, s) => Object.assign(acc, s.properties || {}), {});
      const fields = Object.entries(props).map(([fname, fschema]) => ({ name: fname, type: schemaName(fschema), ...(required.has(fname) ? { required: true } : {}), ...(fschema?.description ? { description: firstSentence(fschema.description, 100) } : {}) }));
      return {
        id,
        name,
        kind: schema.enum ? 'enum' : 'object',
        ...(schema.description ? { description: firstSentence(schema.description, 160) } : {}),
        ...(schema.enum ? { values: schema.enum.map(String) } : { fields }),
      };
    });

  const info = doc.info || {};
  const baseUrl = isV2
    ? (doc.host ? `${(doc.schemes || ['https'])[0]}://${doc.host}${doc.basePath || ''}` : undefined)
    : doc.servers?.[0]?.url;
  return {
    schema_version: 1,
    diagram_type: 'endpoints',
    meta: {
      title: title || info.title || 'API',
      ...(info.description ? { subtitle: firstSentence(info.description, 140) } : {}),
      api_kind: 'rest',
      ...(baseUrl ? { base_url: baseUrl } : {}),
      ...(info.version ? { version: String(info.version) } : {}),
    },
    groups,
    endpoints,
    ...(types.length ? { types } : {}),
    ...(sourcePath ? { cards: [{ title: 'Source', tone: 'info', items: [`Imported from ${sourcePath}`, `${endpoints.length} operations, ${types.length} schemas shown`] }] } : {}),
  };
}
