import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSpec } from '../renderers/shared/validate.mjs';
import { renderSpec, RENDERERS } from '../renderers/shared/render.mjs';
import { importOpenApi } from '../importers/openapi.mjs';
import { importGraphql, parseSdl } from '../importers/graphql.mjs';
import { importPrisma } from '../importers/prisma.mjs';
import { renderDashboard } from '../renderers/shared/dashboard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const json = (p) => JSON.parse(read(p));

for (const name of fs.readdirSync(path.join(root, 'examples')).filter((f) => f.endsWith('.json'))) {
  test(`example ${name} validates and renders`, () => {
    const spec = json(`examples/${name}`);
    const report = validateSpec(spec);
    assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
    const { html, warnings } = renderSpec(spec);
    assert.ok(html.includes('<svg'), 'has svg');
    assert.ok(html.includes('data-node-id='), 'has nodes');
    assert.ok(html.includes('id="vibex-spec"'), 'embeds spec');
    assert.equal(warnings.length, 0, `layout warnings: ${warnings.join('; ')}`);
    const collection = { erd: 'entities', c4: 'elements', endpoints: 'endpoints', lifecycle: 'states' }[spec.diagram_type];
    for (const item of spec[collection]) assert.ok(html.includes(`data-node-id="${item.id}"`), `node ${item.id} rendered`);
  });
}

test('validator catches dangling references and bad enums', () => {
  const report = validateSpec({
    schema_version: 1, diagram_type: 'erd', meta: { title: 'x' },
    entities: [{ id: 'a', name: 'a', columns: [{ name: 'id', pk: true }, { name: 'b_id', fk: 'b.id' }] }],
    relationships: [{ from: 'a', to: 'missing', from_cardinality: 'lots' }],
  });
  const codes = report.errors.map((e) => e.code);
  assert.ok(codes.includes('dangling-fk'));
  assert.ok(codes.includes('dangling-ref'));
  assert.ok(codes.includes('enum'));
});

test('validator rejects unknown diagram type and duplicate ids', () => {
  assert.equal(validateSpec({ schema_version: 1, diagram_type: 'uml', meta: { title: 'x' } }).errors[0].code, 'diagram_type');
  const report = validateSpec({ schema_version: 1, diagram_type: 'c4', meta: { title: 'x' }, elements: [{ id: 'a', kind: 'system', label: 'A' }, { id: 'a', kind: 'system', label: 'B' }] });
  assert.ok(report.errors.some((e) => e.code === 'duplicate-id'));
});

test('render refuses invalid spec', () => {
  const { report, html } = renderSpec({ schema_version: 1, diagram_type: 'endpoints', meta: { title: 'x' }, endpoints: [{ id: 'e', method: 'FETCH', path: '/x' }] });
  assert.equal(html, null);
  assert.ok(report.errors.length > 0);
});

test('openapi import: groups by tag, resolves auth, refs, status codes, and closure of types', () => {
  const spec = importOpenApi(json('test/fixtures/petstore.openapi.json'));
  assert.equal(validateSpec(spec).errors.length, 0);
  assert.deepEqual(spec.groups.map((g) => g.id), ['pets', 'owners']);
  const create = spec.endpoints.find((e) => e.id === 'createPet');
  assert.equal(create.method, 'POST');
  assert.equal(create.request, 'NewPet');
  assert.equal(create.response, 'Pet');
  assert.deepEqual(create.status, [201, 400]);
  assert.equal(create.auth, 'bearerAuth');
  const ownerPets = spec.endpoints.find((e) => e.path === '/owners/{ownerId}/pets');
  assert.equal(ownerPets.auth, 'none');
  assert.equal(ownerPets.response, 'Pet[]');
  assert.equal(ownerPets.params[0].in, 'path');
  assert.ok(spec.endpoints.find((e) => e.id === 'deletePet').deprecated);
  const typeNames = spec.types.map((t) => t.name).sort();
  assert.deepEqual(typeNames, ['NewPet', 'Owner', 'Pet', 'Species']);
  assert.equal(spec.types.find((t) => t.name === 'Species').kind, 'enum');
});

test('graphql sdl parser handles descriptions, args, directives, unions', () => {
  const { defs, roots } = parseSdl(read('test/fixtures/shop.graphql'));
  assert.equal(roots.query, 'Query');
  const order = defs.find((d) => d.name === 'Order');
  assert.equal(order.description, 'An order placed by a user');
  assert.deepEqual(order.implements, ['Node']);
  const query = defs.find((d) => d.name === 'Query');
  const orders = query.fields.find((f) => f.name === 'orders');
  assert.equal(orders.args.length, 3);
  assert.equal(orders.args[1].default, '20');
  assert.equal(orders.type, 'OrderConnection!');
  assert.deepEqual(defs.find((d) => d.name === 'SearchResult').members, ['User', 'Order']);
  assert.deepEqual(defs.find((d) => d.name === 'OrderStatus').values, ['DRAFT', 'PLACED', 'PAID', 'CANCELLED']);
});

test('graphql import → endpoints groups by operation kind', () => {
  const spec = importGraphql(read('test/fixtures/shop.graphql'));
  assert.equal(validateSpec(spec).errors.length, 0);
  assert.deepEqual(spec.groups.map((g) => g.id), ['queries', 'mutations', 'subscriptions']);
  const place = spec.endpoints.find((e) => e.method === 'MUTATION' && e.path.startsWith('placeOrder'));
  assert.equal(place.response, 'Order!');
  assert.equal(place.params[0].required, true);
  assert.ok(spec.types.some((t) => t.name === 'PlaceOrderInput' && t.kind === 'input'));
  assert.ok(!spec.types.some((t) => t.name === 'Query'));
});

test('graphql import → erd infers relationships and skips connection wrappers', () => {
  const spec = importGraphql(read('test/fixtures/shop.graphql'), { erd: true });
  assert.equal(validateSpec(spec).errors.length, 0);
  assert.ok(!spec.entities.some((e) => e.name === 'OrderConnection'));
  const rel = spec.relationships.find((r) => r.from === 'order' && r.to === 'user');
  assert.equal(rel.from_cardinality, 'many');
  assert.equal(rel.to_cardinality, 'one');
  assert.ok(spec.entities.find((e) => e.id === 'orderstatus').kind === 'enum');
});

test('prisma import: fks, composite pk, unique → one-to-one, implicit m:n, enums, sources', () => {
  const spec = importPrisma(read('test/fixtures/shop.prisma'), { sourcePath: 'prisma/schema.prisma' });
  assert.equal(validateSpec(spec).errors.length, 0);
  const order = spec.entities.find((e) => e.id === 'order');
  assert.equal(order.name, 'orders');
  assert.equal(order.columns.find((c) => c.name === 'userId').fk, 'user.id');
  const item = spec.entities.find((e) => e.id === 'orderitem');
  assert.deepEqual(item.columns.filter((c) => c.pk).map((c) => c.name), ['orderId', 'productId']);
  const payment = spec.relationships.find((r) => r.from === 'payment');
  assert.equal(payment.from_cardinality, 'one');
  assert.equal(spec.relationships.find((r) => r.from === 'order' && r.to === 'user').on_delete, 'cascade');
  assert.ok(spec.relationships.some((r) => r.from_cardinality === 'many' && r.to_cardinality === 'many'));
  assert.deepEqual(spec.entities.find((e) => e.id === 'orderstatus').values, ['DRAFT', 'PLACED', 'PAID']);
  assert.equal(order.sources[0].path, 'prisma/schema.prisma');
});

test('dashboard bundles every example, namespaces svg ids, and cross-links entities to endpoints', () => {
  const names = fs.readdirSync(path.join(root, 'examples')).filter((f) => f.endsWith('.json'));
  const items = names.map((n) => ({ file: n.replace(/\.json$/, ''), spec: json(`examples/${n}`) }));
  items.push({ file: 'broken', spec: { schema_version: 1, diagram_type: 'erd', meta: { title: 'x' }, entities: [] } });
  const { html, entries, problems, warnings } = renderDashboard(items, { title: 'T' });
  assert.equal(entries.length, names.length);
  assert.equal(problems.length, 1);
  assert.equal(warnings.length, 0, warnings.join('; '));
  assert.equal((html.match(/class="vibex /g) || []).length, names.length, 'one diagram svg per example');
  assert.equal((html.match(/id="d\d+-m-arrow"/g) || []).length, names.length, 'markers namespaced per diagram');
  assert.ok(!html.includes('url(#m-arrow)'), 'marker refs rewritten');
  assert.ok(html.includes('data-goto-node="order"'), 'entity → endpoint cross-link row present');
  assert.ok(html.includes('id="vibex-specs"'));
  assert.ok(html.includes('VibexViewer'), 'viewer runtime inlined');
});

// ---------------------------------------------------------------------------
// Hardening: hostile specs must render inert output or be rejected.

const hostile = () => json('test/fixtures/hostile.erd.json');
const specBlock = (html, id = 'vibex-spec') => new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)</script>`).exec(html)[1];
const erd = (over) => ({ schema_version: 1, diagram_type: 'erd', meta: { title: 'x' }, entities: [{ id: 'a', name: 'a', columns: [{ name: 'id', pk: true }] }, { id: 'b', name: 'b', columns: [{ name: 'id' }] }], relationships: [{ from: 'a', to: 'b', label: 'owns' }], ...over });
const eps = (over) => ({ schema_version: 1, diagram_type: 'endpoints', meta: { title: 'x' }, endpoints: [{ id: 'e', method: 'GET', path: '/x', summary: 's' }], ...over });
const c4 = (over) => ({ schema_version: 1, diagram_type: 'c4', meta: { title: 'x' }, elements: [{ id: 'a', kind: 'system', label: 'A', description: 'd' }, { id: 'b', kind: 'system', label: 'B', description: 'd' }], relationships: [{ from: 'a', to: 'b', label: 'calls' }], ...over });

test('hostile spec: slot markers, </script> and <!-- in strings never break out (single page)', () => {
  const spec = hostile();
  assert.equal(validateSpec(spec).errors.length, 0);
  const { html } = renderSpec(spec);
  assert.ok(html, 'renders');
  // No raw marker survives: every one was either filled or escaped.
  assert.ok(!html.includes('<!-- VIBEX:'), 'no unfilled or injected slot marker');
  assert.ok(!/<img src=x/.test(html), 'img payload escaped');
  assert.ok(!/<script>document\.title/.test(html), 'script payload escaped');
  assert.ok(html.includes('&lt;!-- VIBEX:LEGEND --&gt;'), 'marker text survives escaped in the title');
  // aria-label on the svg is fully escaped (not just quotes).
  const aria = /<svg [^>]*aria-label="([^"]*)"/.exec(html)[1];
  assert.ok(!aria.includes('<') && aria.includes('&lt;!-- VIBEX:LEGEND --&gt;'));
  // Embedded JSON round-trips and contains no "<" at all.
  const raw = specBlock(html);
  assert.ok(!raw.includes('<'), 'no literal < in embedded JSON');
  const back = JSON.parse(raw);
  assert.equal(back.meta.title, spec.meta.title);
  assert.equal(back.meta.description, spec.meta.description);
  assert.equal(back.cards[0].items[1], '</script>');
});

test('hostile spec: dashboard applies the same single-pass slot filling', () => {
  const { html, problems } = renderDashboard([{ file: 'hostile', spec: hostile() }, { file: 'orders', spec: json('examples/orders.erd.json') }], { title: 'D<!-- VIBEX:SPECS -->' });
  assert.equal(problems.length, 0);
  assert.ok(!html.includes('<!-- VIBEX:'), 'no marker left or injected');
  assert.ok(!/<img src=x/.test(html));
  const specs = JSON.parse(specBlock(html, 'vibex-specs'));
  assert.equal(specs.length, 2);
  assert.ok(specs.some((s) => s.meta.title.includes('<!-- VIBEX:LEGEND -->')));
});

test('validator: layout values must be numbers in range', () => {
  const codes = (spec) => validateSpec(spec).errors.map((e) => `${e.code}:${e.at}`);
  assert.ok(codes(eps({ layout: { card_width: '1"><script>x</script>' } })).includes('type:layout.card_width'));
  assert.ok(codes(eps({ layout: { columns: -1 } })).includes('range:layout.columns'));
  assert.ok(codes(eps({ layout: { columns: '3' } })).includes('type:layout.columns'));
  assert.ok(codes(erd({ layout: { gapX: '" onload="alert(1)' } })).includes('type:layout.gapX'));
  assert.ok(codes(erd({ layout: { cols: 0 } })).includes('range:layout.cols'));
  assert.ok(codes(c4({ layout: { gapY: -5 } })).includes('range:layout.gapY'));
  assert.equal(codes(eps({ layout: { columns: 2, card_width: 400, show_types: false } })).length, 0);
});

test('renderers coerce layout defensively even when validation is bypassed', () => {
  const { renderEndpoints } = renderersFor('endpoints');
  const r = renderEndpoints(eps({ layout: { card_width: '1"><script>x</script>', columns: -1 } }));
  assert.ok(!r.svg.includes('<script>'));
  assert.ok(/viewBox="0 0 \d+ \d+"/.test(r.svg), 'numeric viewBox');
  const { renderErd } = renderersFor('erd');
  const e = renderErd(erd({ layout: { gapX: '" onload="alert(1)' }, entities: [{ id: 'a', name: 'a', row: -1, col: -1, columns: [{ name: 'id' }] }, { id: 'b', name: 'b', columns: [{ name: 'id' }] }] }));
  assert.ok(!e.svg.includes('NaN') && !e.svg.includes('onload='));
});

test('validator: status must be an array; renderer tolerates a bad one', () => {
  assert.ok(validateSpec(eps({ endpoints: [{ id: 'e', method: 'GET', path: '/x', status: '200' }] })).errors.some((e) => e.code === 'type' && e.at === 'endpoints[0]'));
  assert.equal(validateSpec(eps({ endpoints: [{ id: 'e', method: 'GET', path: '/x', status: [200, '2XX'] }] })).errors.length, 0);
  const { renderEndpoints } = renderersFor('endpoints');
  assert.ok(renderEndpoints(eps({ endpoints: [{ id: 'e', method: 'GET', path: '/x', status: '200' }] })).svg.includes('<svg'));
});

test('validator: row/col bounds and duplicate cells; renderers survive them anyway', () => {
  assert.ok(validateSpec(c4({ elements: [{ id: 'a', kind: 'system', label: 'A', row: -1, description: 'd' }] })).errors.some((e) => e.code === 'range'));
  assert.ok(validateSpec(erd({ entities: [{ id: 'a', name: 'a', row: -1, col: -1, columns: [{ name: 'id' }] }, { id: 'b', name: 'b', columns: [{ name: 'id' }] }] })).errors.some((e) => e.code === 'range'));
  assert.ok(validateSpec(erd({ entities: [{ id: 'a', name: 'a', row: 0, col: 0, columns: [{ name: 'id' }] }, { id: 'b', name: 'b', row: 0, col: 0, columns: [{ name: 'id' }] }] })).errors.some((e) => e.code === 'duplicate-cell'));
  assert.ok(validateSpec(erd({ entities: [{ id: 'a', name: 'a', row: 1e9, col: 0, columns: [{ name: 'id' }] }, { id: 'b', name: 'b', columns: [{ name: 'id' }] }] })).errors.some((e) => e.code === 'range'));
  const { renderC4 } = renderersFor('c4');
  assert.ok(renderC4(c4({ elements: [{ id: 'a', kind: 'system', label: 'A', row: -1, description: 'd' }, { id: 'b', kind: 'system', label: 'B', description: 'd' }] })).svg.includes('data-node-id="a"'));
  const { renderErd } = renderersFor('erd');
  const dup = renderErd(erd({ entities: [{ id: 'a', name: 'a', row: 0, col: 0, columns: [{ name: 'id' }] }, { id: 'b', name: 'b', row: 0, col: 0, columns: [{ name: 'id' }] }] }));
  assert.ok(dup.svg.includes('data-node-id="b"') && !dup.svg.includes('NaN'));
});

test('validator: javascript: links and repository urls are rejected; only http(s) allowed', () => {
  assert.ok(validateSpec(c4({ elements: [{ id: 'a', kind: 'system', label: 'A', description: 'd', link: "javascript:document.title='X'" }] })).errors.some((e) => e.code === 'url'));
  const withLink = (link) => c4({ elements: [{ id: 'a', kind: 'system', label: 'A', description: 'd', link }, { id: 'b', kind: 'system', label: 'B', description: 'd' }] });
  assert.equal(validateSpec(withLink('shop.container.html')).errors.length, 0);
  assert.equal(validateSpec(withLink('https://example.com/x')).errors.length, 0);
  assert.ok(validateSpec(withLink('data:text/html,hi')).errors.some((e) => e.code === 'url'));
  assert.ok(validateSpec(erd({ meta: { title: 'x', repository: { url: "javascript:document.title='R'//" } } })).errors.some((e) => e.code === 'url'));
  assert.ok(validateSpec(erd({ entities: [{ id: 'a', name: 'a', columns: [{ name: 'id' }], sources: [{ path: 'javascript:alert(1)' }] }, { id: 'b', name: 'b', columns: [{ name: 'id' }] }] })).errors.some((e) => e.code === 'path'));
  // Legitimate dotted file names are fine; ".." segments are not.
  assert.equal(validateSpec(erd({ entities: [{ id: 'a', name: 'a', columns: [{ name: 'id' }], sources: [{ path: 'src/a..b.ts' }] }, { id: 'b', name: 'b', columns: [{ name: 'id' }] }] })).errors.length, 0);
  assert.ok(validateSpec(erd({ entities: [{ id: 'a', name: 'a', columns: [{ name: 'id' }], sources: [{ path: 'src/../etc' }] }, { id: 'b', name: 'b', columns: [{ name: 'id' }] }] })).errors.some((e) => e.code === 'path'));
});

test('validator: null or non-object items are reported, never thrown', () => {
  for (const spec of [
    erd({ relationships: [null] }),
    erd({ entities: [{ id: 'a', name: 'a' }, null] }),
    erd({ groups: [null] }),
    c4({ boundaries: [null] }),
    c4({ elements: ['x'] }),
    c4({ relationships: [42] }),
    eps({ groups: [null], types: [null], endpoints: [null] }),
    eps({ layout: 'wide' }),
    { schema_version: 1, diagram_type: 'erd', meta: { title: 'x' }, entities: [{ id: 'a', name: 'a', columns: 'nope' }] },
  ]) {
    let report;
    assert.doesNotThrow(() => { report = validateSpec(spec); });
    assert.ok(report.errors.length > 0, JSON.stringify(spec));
  }
});

test('validator: group ids may not shadow entity/type ids', () => {
  assert.ok(validateSpec(erd({ groups: [{ id: 'a', label: 'g', entities: ['a', 'b'] }] })).errors.some((e) => e.code === 'id-clash'));
  assert.ok(validateSpec(eps({ groups: [{ id: 'T', label: 'g' }], types: [{ id: 'T', name: 'T', fields: [] }] })).errors.some((e) => e.code === 'id-clash'));
});

test('endpoints: ungrouped endpoints get a synthetic group that is embedded in the spec', () => {
  const { html } = renderSpec(eps({ groups: [{ id: 'default', label: 'Declared default' }], endpoints: [{ id: 'e', method: 'GET', path: '/x', summary: 's' }, { id: 'f', group: 'default', method: 'POST', path: '/y', summary: 's' }] }));
  const embedded = JSON.parse(specBlock(html));
  const synthetic = embedded.groups.find((g) => g.synthetic);
  assert.ok(synthetic && synthetic.id !== 'default', 'synthetic id avoids the declared one');
  assert.ok(html.includes(`data-node-id="${synthetic.id}"`));
});

test('graphql: extend type merges into the original definition', () => {
  const sdl = 'type Query { a(limit: Int = 10): [User!]! }\nextend type Query { b: Int }\ntype Mutation { doIt: Boolean }\nextend type Mutation { undoIt: Boolean }\ntype User { id: ID! }\nextend type User { name: String }\nenum Role { ADMIN }\nextend enum Role { USER }';
  const spec = importGraphql(sdl);
  assert.deepEqual(spec.endpoints.map((e) => `${e.method} ${e.path.split('(')[0]}`).sort(), ['MUTATION doIt', 'MUTATION undoIt', 'QUERY a', 'QUERY b']);
  const user = spec.types.find((t) => t.name === 'User');
  assert.deepEqual(user.fields.map((f) => f.name), ['id', 'name']);
  const { defs } = parseSdl(sdl);
  assert.deepEqual(defs.find((d) => d.name === 'Role').values, ['ADMIN', 'USER']);
});

test('openapi: $ref parameters, request bodies and responses resolve; 2XX counts as success', () => {
  const v2 = importOpenApi({ swagger: '2.0', info: { title: 't' }, parameters: { idParam: { name: 'id', in: 'path', type: 'string', required: true } }, paths: { '/x/{id}': { parameters: [{ $ref: '#/parameters/idParam' }], get: { responses: { 200: { schema: { $ref: '#/definitions/X' } } } } } }, definitions: { X: { type: 'object', properties: { id: { type: 'string' } } } } });
  assert.equal(validateSpec(v2).errors.length, 0);
  assert.deepEqual(v2.endpoints[0].params, [{ name: 'id', in: 'path', type: 'string', required: true }]);
  const v3 = importOpenApi({ openapi: '3.0.0', info: { title: 't' }, components: { parameters: { q: { name: 'q', in: 'query', schema: { type: 'string' } } }, requestBodies: { Body: { content: { 'application/json': { schema: { $ref: '#/components/schemas/In' } } } } }, responses: { Ok: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Out' } } } } }, schemas: { In: { type: 'object' }, Out: { type: 'object' } } }, paths: { '/y': { post: { parameters: [{ $ref: '#/components/parameters/q' }], requestBody: { $ref: '#/components/requestBodies/Body' }, responses: { '2XX': { $ref: '#/components/responses/Ok' } } } } } });
  assert.equal(validateSpec(v3).errors.length, 0);
  assert.equal(v3.endpoints[0].params[0].name, 'q');
  assert.equal(v3.endpoints[0].request, 'In');
  assert.equal(v3.endpoints[0].response, 'Out');
});

test('prisma: // inside string literals is not a comment', () => {
  const spec = importPrisma('model A {\n  id  Int    @id // real comment\n  url String @default("https://example.com") @map("u//rl")\n}');
  const url = spec.entities[0].columns.find((c) => c.name === 'url');
  assert.equal(url.default, '"https://example.com"');
  assert.equal(url.note, 'column u//rl');
});

test('layout: rounded path is well formed and skips zero-length segments', async () => {
  const { pathFromPoints, placeLabel } = await import('../renderers/shared/layout.mjs');
  const d = pathFromPoints([[0, 0], [100, 0], [100, 80]], 8);
  assert.ok(d.startsWith('M 0 0'), d);
  assert.equal((d.match(/Q /g) || []).length, 1, 'one corner curve');
  assert.ok(d.endsWith('L 100 80'), d);
  assert.ok(!/NaN/.test(pathFromPoints([[0, 0], [0, 0], [50, 0], [50, 0], [50, 50]], 8)));
  assert.equal(pathFromPoints([[3, 4]]), 'M 3 4');
  // A degenerate route (single point) still yields a label box.
  const box = placeLabel([[10, 10]], 40, 14, []);
  assert.deepEqual([box.w, box.h], [40, 14]);
});

test('svg: root is a labelled group (not role=img) and edges are labelled buttons', () => {
  const { html } = renderSpec(json('examples/orders.erd.json'));
  assert.ok(/<svg [^>]*role="group"/.test(html));
  assert.ok(/<g id="edge-[^"]+"[^>]*role="button"[^>]*aria-label="/.test(html));
  assert.ok(!/class="edge-label"[^>]*tabindex/.test(html), 'label copies are not extra tab stops');
});

function renderersFor(type) {
  return {
    erd: { renderErd: RENDERERS.erd }, c4: { renderC4: RENDERERS.c4 }, endpoints: { renderEndpoints: RENDERERS.endpoints },
  }[type];
}

test('lifecycle validator: dangling transition is an error; unreachable, dead-end and terminal-exit are warnings', () => {
  const report = validateSpec({
    schema_version: 1, diagram_type: 'lifecycle', meta: { title: 'x' },
    states: [
      { id: 'a', label: 'A', kind: 'initial' }, { id: 'b', label: 'B' }, { id: 'lost', label: 'Lost' },
      { id: 'end', label: 'End', kind: 'terminal' }, { id: 'stuck', label: 'Stuck' },
    ],
    transitions: [
      { from: 'a', to: 'b', event: 'go' }, { from: 'b', to: 'end', event: 'finish' }, { from: 'end', to: 'a', event: 'loop' },
      { from: 'a', to: 'stuck' }, { from: 'a', to: 'nowhere', event: 'x' },
    ],
  });
  assert.deepEqual(report.errors.map((e) => e.code), ['dangling-ref']);
  const codes = report.warnings.map((w) => w.code);
  for (const c of ['unreachable', 'terminal-exit', 'dead-end', 'event']) assert.ok(codes.includes(c), `expected warning ${c} in ${codes}`);
});

test('lifecycle render: start dot on the initial state, failure arrows red, dashed auto transitions', () => {
  const spec = json('examples/order.lifecycle.json');
  const { html, warnings } = renderSpec(spec);
  assert.equal(warnings.length, 0);
  assert.ok(html.includes('class="start"'), 'start dot');
  assert.ok(html.includes('m-arrow-failure'), 'failure marker used');
  assert.ok(/class="edge lc-transition auto dashed"/.test(html), 'auto transitions dashed');
  assert.ok(html.includes('class="box-inner"'), 'terminal double border');
});
