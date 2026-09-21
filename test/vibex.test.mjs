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
import { channelOffsets, routeOrthogonal, placeLabel, overlapArea } from '../renderers/shared/layout.mjs';
import { hashRegion, checkAnchor } from '../renderers/docs/anchors.mjs';
import { buildGraph } from '../renderers/docs/graph.mjs';
import { runGenerator } from '../renderers/docs/facts.mjs';
import { renderDocsPanel } from '../renderers/docs/render-docs.mjs';
import { renderMarkdown, citationsIn } from '../renderers/docs/markdown.mjs';
import { toMarkdown } from '../renderers/docs/to-markdown.mjs';
import { head, dirtyPaths, changedSince, shortSha, prefix as gitPrefix, underPrefix } from '../renderers/docs/git.mjs';
import { planCheck, mergeLock, verifiedCommits } from '../renderers/docs/incremental.mjs';
import { issueUrl, contextBlock, issueEndpoint } from '../renderers/shared/intake.mjs';
import { parseIntake, triage, PLAYBOOK } from '../renderers/shared/triage.mjs';
import { readCommits, buildChangelog, diffClaims, resolve as resolveRef } from '../renderers/changelog/from-git.mjs';
import { changelogToMarkdown } from '../renderers/changelog/to-markdown.mjs';
import { renderChangelogPanel, changelogNavHtml } from '../renderers/changelog/render-changelog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const json = (p) => JSON.parse(read(p));

// Examples that render to a diagram. `docs` specs live alongside them but
// describe the system in claims rather than nodes, so they are checked apart.
const DIAGRAM_EXAMPLES = fs.readdirSync(path.join(root, 'examples'))
  .filter((f) => /\.(erd|c4|endpoints|lifecycle)\.json$/.test(f));

for (const name of DIAGRAM_EXAMPLES) {
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
  const names = DIAGRAM_EXAMPLES;
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

test('routing: edges crossing one gap get their own lane, and only when their turns overlap', () => {
  const rects = new Map([
    ['src', { x: 0, y: 0, w: 100, h: 60 }],
    ['near', { x: 300, y: 0, w: 100, h: 60 }],
    ['mid', { x: 300, y: 150, w: 100, h: 60 }],
    ['far', { x: 300, y: 300, w: 100, h: 60 }],
  ]);
  const edges = [{ from: 'src', to: 'near' }, { from: 'src', to: 'mid' }, { from: 'src', to: 'far' }];
  const lanes = channelOffsets(edges, rects);

  // src→near is a straight run with no turn, so it needs no lane.
  assert.equal(lanes[0], 0);
  // The other two turn over overlapping stretches, so they must separate.
  assert.notEqual(lanes[1], lanes[2]);

  // Lanes stay inside the gap (100..300) rather than running over either box.
  for (let i = 0; i < edges.length; i += 1) {
    const r = routeOrthogonal(rects.get(edges[i].from), rects.get(edges[i].to), { from: 0, to: 0, channel: lanes[i] });
    for (const [x] of r.points) assert.ok(x >= 100 && x <= 300, `turn at x=${x} escaped the gap`);
  }

  // A pair whose turns do not overlap can share one lane and stay centred.
  const apart = new Map([
    ['a', { x: 0, y: 0, w: 100, h: 60 }], ['b', { x: 300, y: 200, w: 100, h: 60 }],
    ['c', { x: 0, y: 500, w: 100, h: 60 }], ['d', { x: 300, y: 700, w: 100, h: 60 }],
  ]);
  assert.deepEqual(channelOffsets([{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }], apart), [0, 0]);
});

test('docs example: claims are unique, resolvable, and declare evidence rather than confidence', () => {
  const spec = json('examples/shop.docs.json');
  const REF = /^[a-zA-Z][a-zA-Z0-9_.-]*(#[a-zA-Z][a-zA-Z0-9_.-]*)?$/;
  const ids = new Set();

  for (const c of spec.claims) {
    assert.ok(!ids.has(c.id), `duplicate claim id ${c.id}`);
    ids.add(c.id);

    // Evidence is declared; confidence is computed by the build. A claim that
    // rates itself is the failure mode this schema exists to prevent.
    assert.equal(c.confidence, undefined, `claim ${c.id} must not declare its own confidence`);
    assert.ok(['anchored', 'asserted'].includes(c.source.kind), `claim ${c.id} has non-authorable source ${c.source.kind}`);

    if (c.source.kind === 'anchored') {
      assert.match(c.source.hash, /^[0-9a-f]{12}$/, `claim ${c.id} anchor hash malformed`);
      assert.ok(!/^\/|^[a-zA-Z]:|\.\.|:\/\//.test(c.source.path), `claim ${c.id} anchor path must be repo-relative`);
    } else {
      assert.match(c.source.at, /^\d{4}-\d{2}-\d{2}$/, `claim ${c.id} needs an ISO confirmation date`);
      assert.ok(c.source.by, `claim ${c.id} needs someone behind it`);
    }

    if (c.subject) assert.match(c.subject, REF, `claim ${c.id} subject is not a ref`);
  }

  for (const c of spec.claims) {
    if (c.supersedes) assert.ok(ids.has(c.supersedes), `claim ${c.id} supersedes unknown ${c.supersedes}`);
  }
  for (const s of spec.sections) {
    for (const id of s.claims || []) assert.ok(ids.has(id), `section ${s.id} lists unknown claim ${id}`);
  }

  // Every claim reaches a reader: listed in a section, or attached to a subject
  // a generated section will render.
  const placed = new Set(spec.sections.flatMap((s) => s.claims || []));
  for (const c of spec.claims) assert.ok(placed.has(c.id) || c.subject, `claim ${c.id} is unreachable`);

  assert.ok(spec.coverage.out_of_scope.length > 0, 'a docs spec must state its own boundary');
});

// ---------------------------------------------------------------- docs layer

const docsExample = () => json('examples/shop.docs.json');
const coveredSpecs = () => new Map([
  ['shop.c4', json('examples/shop.c4.json')],
  ['orders.erd', json('examples/orders.erd.json')],
  ['shop.endpoints', json('examples/shop.endpoints.json')],
]);
const NOW = Date.parse('2026-09-19T00:00:00Z');

test('docs validator: a claim may declare evidence, never its own confidence', () => {
  const base = docsExample();

  const rated = structuredClone(base);
  rated.claims[0].confidence = 'verified';
  assert.ok(validateSpec(rated).errors.some((e) => e.code === 'confidence-authored'));

  const forged = structuredClone(base);
  forged.claims[0].source = { kind: 'derived', spec: 'shop.c4', rule: 'c4.elements' };
  assert.ok(validateSpec(forged).errors.some((e) => e.code === 'derived-authored'));
});

test('docs validator: anchors need a real hash and a repo-relative path; assertions need a name and a date', () => {
  const bad = docsExample();
  const anchored = bad.claims.find((c) => c.source.kind === 'anchored');
  anchored.source.hash = 'nope';
  anchored.source.path = '/etc/passwd';
  const asserted = bad.claims.find((c) => c.source.kind === 'asserted');
  delete asserted.source.by;
  asserted.source.at = 'last tuesday';

  const codes = validateSpec(bad).errors.map((e) => e.code);
  for (const c of ['hash', 'path', 'missing', 'date']) assert.ok(codes.includes(c), `expected ${c} in ${codes}`);
});

test('docs validator: dangling references and compound claims are caught', () => {
  const spec = docsExample();
  spec.sections[0].claims.push('does.not.exist');
  spec.claims[0].text = 'The platform sells products, and ops staff manage refunds.';
  spec.claims[1].supersedes = 'also.missing';

  const report = validateSpec(spec);
  const errors = report.errors.map((e) => e.code);
  assert.ok(errors.filter((c) => c === 'dangling-ref').length >= 2, errors.join(','));
  assert.ok(report.warnings.some((w) => w.code === 'compound'));
});

test('docs validator: a document that states no boundary is warned about', () => {
  const spec = docsExample();
  spec.coverage = { out_of_scope: [] };
  assert.ok(validateSpec(spec).warnings.some((w) => w.code === 'no-boundary'));
});

test('anchors: reformatting does not flag a claim, editing does', () => {
  const before = 'class SessionService {\n  issue() {\n    return token();\n  }\n}';
  const reformatted = 'class SessionService {\n      issue() {\n            return token();\n      }\n}';
  const edited = 'class SessionService {\n  issue() {\n    return cookie();\n  }\n}';
  const source = { path: 'a.ts', symbol: 'SessionService', hash: hashRegion(before) };

  assert.equal(checkAnchor(source, () => reformatted).state, 'match');
  assert.equal(checkAnchor(source, () => edited).state, 'changed');
  assert.equal(checkAnchor(source, () => null).state, 'missing');
  assert.equal(checkAnchor(source, () => 'class Other {}').state, 'missing');
});

test('docs graph: confidence is computed from evidence and freshness', () => {
  const spec = docsExample();
  const specs = coveredSpecs();
  const anchored = spec.claims.filter((c) => c.source.kind === 'anchored').map((c) => c.id);

  // Every anchor verified.
  const allGood = new Map(anchored.map((id) => [id, { state: 'match', detail: '' }]));
  let g = buildGraph(spec, { specs, anchorStatus: allGood, now: NOW });
  assert.equal(g.coverage.counts.broken, 0);
  assert.equal(g.coverage.counts.stale, 0);

  // One file changed underneath its claim.
  const oneStale = new Map(allGood);
  oneStale.set(anchored[0], { state: 'changed', detail: 'a.ts changed' });
  g = buildGraph(spec, { specs, anchorStatus: oneStale, now: NOW });
  assert.equal(g.coverage.counts.stale, 1);
  assert.equal(g.claims.find((c) => c.id === anchored[0]).confidence, 'stale');

  // An anchor nobody checked establishes nothing.
  g = buildGraph(spec, { specs, now: NOW });
  assert.equal(g.coverage.counts.broken, anchored.length);
  assert.match(g.claims.find((c) => c.id === anchored[0]).detail, /not checked/);

  // An assertion goes stale on a clock, not on a file.
  const aged = structuredClone(spec);
  for (const c of aged.claims) if (c.source.kind === 'asserted') c.source.at = '2025-01-01';
  g = buildGraph(aged, { specs, anchorStatus: allGood, now: NOW });
  assert.equal(g.coverage.counts.asserted, 0);
  assert.ok(g.coverage.counts.expired > 0);
  assert.match(g.claims.find((c) => c.source.kind === 'asserted').detail, /review window/);
});

test('docs graph: subjects gather their claims and resolve edges both ways', () => {
  const g = buildGraph(docsExample(), { specs: coveredSpecs(), now: NOW });

  const bff = g.subjects.find((s) => s.ref === 'shop.c4#bff');
  assert.ok(bff.claims.length >= 3, 'derived and authored claims land on the same subject');
  assert.ok(bff.related.some((r) => r.relation === 'connects-to' && r.ref === 'shop.c4#order_api'));

  const orderApi = g.subjects.find((s) => s.ref === 'shop.c4#order_api');
  assert.ok(orderApi.related.some((r) => r.relation === 'used-by' && r.ref === 'shop.c4#bff'), 'reverse edge present');

  // Every claim id in a section resolves to a claim in the flat list.
  const ids = new Set(g.claims.map((c) => c.id));
  for (const s of g.sections) for (const id of s.claims) assert.ok(ids.has(id), `section ${s.id} cites missing ${id}`);
});

test('docs graph: a subject that does not resolve is reported, not silently dropped', () => {
  const spec = docsExample();
  spec.claims.push({
    id: 'ghost', text: 'Something is true of a table that does not exist.',
    subject: 'orders.erd#no_such_table',
    source: { kind: 'asserted', by: 'test', at: '2026-09-19' },
  });
  const g = buildGraph(spec, { specs: coveredSpecs(), now: NOW });
  assert.ok(g.coverage.unknown.some((u) => u.what === 'ghost'), 'dangling subject surfaces in coverage.unknown');

  // A spec listed in covers but never supplied is named too.
  const partial = buildGraph(spec, { specs: new Map([['shop.c4', json('examples/shop.c4.json')]]), now: NOW });
  assert.ok(partial.coverage.unknown.some((u) => u.what === 'orders.erd'));
});

test('docs graph: derived facts are reproducible and never inflect author fragments', () => {
  const spec = docsExample();
  const a = buildGraph(spec, { specs: coveredSpecs(), now: NOW });
  const b = buildGraph(spec, { specs: coveredSpecs(), now: NOW });
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'same inputs, same graph');

  const lc = json('examples/order.lifecycle.json');
  const transitions = runGenerator('lifecycle.transitions', lc, 'order.lc');
  const guarded = lc.transitions.find((t) => t.guard);
  const claim = transitions.find((c) => c.text.includes('Only when'));
  assert.ok(claim.text.includes(guarded.guard), 'the guard is quoted verbatim, not conjugated');
  assert.ok(!/It only applies when \w+ \w+ set\b/.test(claim.text));

  // Derived claims carry the rule that produced them, so a reader can redo it.
  for (const c of a.claims) {
    if (c.source.kind !== 'derived') continue;
    assert.ok(c.source.rule && c.source.spec, `${c.id} lost its provenance`);
  }
});

test('anchors against the fixture repo: the shipped example verifies, a reformat is ignored, an edit is caught', () => {
  const repo = path.join(root, 'examples/shop-repo');
  const readFile = (rel) => {
    const abs = path.resolve(repo, rel);
    if (!abs.startsWith(repo + path.sep)) return null;
    try { return fs.readFileSync(abs, 'utf8'); } catch { return null; }
  };
  const spec = docsExample();
  const anchored = spec.claims.filter((c) => c.source.kind === 'anchored');
  assert.ok(anchored.length >= 4, 'the example exercises anchoring');

  // Every hash committed in the example matches the committed fixture.
  const status = new Map(anchored.map((c) => [c.id, checkAnchor(c.source, readFile)]));
  for (const [id, st] of status) assert.equal(st.state, 'match', `${id}: ${st.detail}`);

  const g = buildGraph(spec, { specs: coveredSpecs(), anchorStatus: status, now: NOW });
  assert.equal(g.coverage.counts.broken, 0);
  assert.equal(g.coverage.counts.stale, 0);

  // Reindenting the anchored region changes nothing.
  const target = anchored[0].source;
  const original = readFile(target.path);
  const reindented = original.split('\n').map((l) => (l.trim() ? `    ${l}` : l)).join('\n');
  assert.equal(checkAnchor(target, () => reindented).state, 'match');

  // Changing a token inside the anchored range does.
  const lines = original.split('\n');
  lines[target.line - 1] = `${lines[target.line - 1]} // behaviour changed`;
  assert.equal(checkAnchor(target, () => lines.join('\n')).state, 'changed');

  // Changing a line outside the anchored range does not.
  const outside = original.split('\n');
  outside[0] = `${outside[0]} // unrelated`;
  assert.equal(checkAnchor(target, () => outside.join('\n')).state, 'match');
});

test('path traversal in an anchor cannot read outside the repo', () => {
  const repo = path.join(root, 'examples/shop-repo');
  const readFile = (rel) => {
    const abs = path.resolve(repo, rel);
    if (!abs.startsWith(repo + path.sep)) return null;
    try { return fs.readFileSync(abs, 'utf8'); } catch { return null; }
  };
  assert.equal(readFile('../../../package.json'), null);
  assert.equal(checkAnchor({ path: '../../../package.json', hash: '0'.repeat(12) }, readFile).state, 'missing');

  // The validator rejects such a path before it ever reaches the filesystem.
  const spec = docsExample();
  spec.claims.find((c) => c.source.kind === 'anchored').source.path = '../secrets.env';
  assert.ok(validateSpec(spec).errors.some((e) => e.code === 'path'));
});

test('dashboard: a docs spec becomes a panel without consuming a diagram index', () => {
  const items = [...DIAGRAM_EXAMPLES.map((n) => ({ file: n.replace(/\.json$/, ''), spec: json(`examples/${n}`) })),
    { file: 'shop.docs', spec: docsExample() }];
  const { html, entries, problems, warnings, docsGraph } = renderDashboard(items, { title: 'T' });

  assert.equal(problems.length, 0, JSON.stringify(problems));
  assert.equal(warnings.length, 0, warnings.join('; '));
  assert.equal(entries.length, DIAGRAM_EXAMPLES.length, 'the docs spec takes no diagram slot');
  assert.equal((html.match(/class="vibex /g) || []).length, DIAGRAM_EXAMPLES.length, 'still one svg per diagram');
  assert.ok(html.includes('data-panel="docs-0"'), 'docs panel present');
  assert.ok(docsGraph.claims.length > 0);

  // A claim's subject chip points at the panel that actually holds that node.
  const c4Index = entries.find((e) => e.spec.diagram_type === 'c4').index;
  assert.ok(html.includes(`data-goto-panel="${c4Index}" data-goto-node="bff"`), 'subject chip resolves to the c4 panel');

  // Without diagrams there is nothing to derive from, and the graph says so.
  const alone = renderDashboard([{ file: 'shop.docs', spec: docsExample() }], { title: 'T' });
  assert.equal(alone.entries.length, 0);
  assert.ok(alone.docsGraph.coverage.unknown.length >= 3, 'every uncovered spec is named');
});

test('dashboard: every docs spec gets its own panel, so topics stay separate documents', () => {
  const auth = docsExample();
  auth.meta.id = 'auth.docs';
  auth.meta.title = 'How authentication works';
  const { html, warnings, docsGraphs } = renderDashboard([
    { file: 'shop.c4', spec: json('examples/shop.c4.json') },
    { file: 'shop.docs', spec: docsExample() },
    { file: 'auth.docs', spec: auth },
  ], { title: 'T' });

  assert.equal(warnings.length, 0, warnings.join('; '));
  assert.equal(docsGraphs.length, 2);
  assert.ok(html.includes('data-panel="docs-0"') && html.includes('data-panel="docs-1"'), 'one panel each');
  assert.ok(html.includes('How authentication works'), 'each document keeps its own title in the nav');

  // One "Documentation" group, both documents inside it.
  assert.equal((html.match(/<h2>Documentation<\/h2>/g) || []).length, 1);
  assert.equal((html.match(/data-type="docs"/g) || []).length, 2);

  // Anchor status is resolved per document, not shared across them.
  const seen = [];
  renderDashboard([
    { file: 'shop.c4', spec: json('examples/shop.c4.json') },
    { file: 'shop.docs', spec: docsExample() },
    { file: 'auth.docs', spec: auth },
  ], { title: 'T', anchorStatus: (spec, file) => { seen.push(file); return new Map(); } });
  assert.deepEqual(seen.sort(), ['auth.docs', 'shop.docs']);
});

test('docs panel: authored text is escaped, and confidence is always rendered beside it', () => {
  const spec = docsExample();
  spec.claims.push({
    id: 'hostile',
    text: '</p><img src=x onerror=alert(1)> "quoted" & <b>bold</b>',
    subject: 'shop.c4#bff',
    source: { kind: 'asserted', by: '<script>alert(2)</script>', at: '2026-09-19' },
  });
  spec.sections[0].claims.push('hostile');

  const graph = buildGraph(spec, { specs: coveredSpecs(), now: NOW });
  const html = renderDocsPanel(graph, { resolveSubject: () => ({ panel: 0, node: 'bff', label: 'BFF' }) });

  assert.ok(!html.includes('<img src=x'), 'no raw tag from claim text');
  assert.ok(!html.includes('<script>alert(2)'), 'no raw tag from the author name');
  assert.ok(html.includes('&lt;img src=x'), 'it is shown, escaped');

  // Every rendered claim carries its confidence: nothing reads as fact by default.
  const claims = html.match(/<li class="claim"[^>]*>/g) || [];
  assert.equal(claims.length, graph.claims.length);
  for (const c of claims) assert.match(c, /data-conf="(verified|asserted|stale|broken|expired)"/);
});

test('docs panel: a document with no stated boundary is called out in the coverage block', () => {
  const spec = docsExample();
  spec.coverage = { out_of_scope: [] };
  const html = renderDocsPanel(buildGraph(spec, { specs: coveredSpecs(), now: NOW }));
  assert.match(html, /reads as if it covers everything/);

  const honest = renderDocsPanel(buildGraph(docsExample(), { specs: coveredSpecs(), now: NOW }));
  assert.ok(!/reads as if it covers everything/.test(honest));
  assert.match(honest, /Search indexing/, 'declared gaps are shown to the reader');
});

test('renderSpec refuses a docs spec with a message instead of crashing', () => {
  const { report, html } = renderSpec(docsExample());
  assert.equal(html, null);
  assert.ok(report.errors.some((e) => e.code === 'not-a-diagram'), JSON.stringify(report.errors));
  assert.match(report.errors[0].message, /vibex docs|dashboard/);
});

// -------------------------------------------------- markdown, git, incremental

test('markdown: agent-written prose cannot smuggle HTML, and unsafe links are dropped', () => {
  const src = [
    '# Heading', '',
    'Text with **bold**, *em*, `code`, [ok](https://example.com), [bad](javascript:alert(1)).', '',
    '<img src=x onerror=alert(1)>', '',
    '| A | B |', '|---|---|', '| <b>1</b> | 2 |', '',
    '```js', 'const x = "</script>";', '```',
  ].join('\n');
  const html = renderMarkdown(src);

  assert.ok(!/<img|<b>1<\/b>|<\/script>/.test(html), 'no tag survives from the source');
  assert.ok(html.includes('&lt;img src=x'), 'it is shown escaped instead');
  assert.ok(!html.includes('javascript:'), 'unsafe href dropped');
  assert.ok(html.includes('href="https://example.com"'), 'safe href kept');
  assert.ok(html.includes('<strong>bold</strong>') && html.includes('<em>em</em>'));
  // Narrative headings nest under the section heading the panel already printed.
  assert.ok(html.includes('<h3>Heading</h3>'), 'h1 in narrative becomes h3');
});

test('markdown: citations resolve to claims and are reported for validation', () => {
  const src = 'Sessions live at the edge [[bff.session-owner]] and nowhere else [[missing.claim]].';
  assert.deepEqual(citationsIn(src), ['bff.session-owner', 'missing.claim']);

  const html = renderMarkdown(src, { resolveCitation: (id) => (id === 'bff.session-owner' ? `<a data-c="${id}"></a>` : null) });
  assert.ok(html.includes('data-c="bff.session-owner"'), 'known citation resolved');
  assert.ok(html.includes('[[missing.claim]]'), 'unknown citation left visible rather than silently dropped');

  // The validator is what turns that visible marker into a build failure.
  const spec = docsExample();
  spec.sections[0].narrative = 'Prose citing [[no.such.claim]].';
  assert.ok(validateSpec(spec).errors.some((e) => e.code === 'dangling-ref'));
});

test('markdown export: every claim appears with its confidence, not just the ones on screen', () => {
  const graph = buildGraph(docsExample(), { specs: coveredSpecs(), now: NOW });
  const md = toMarkdown(graph);
  for (const c of graph.claims) assert.ok(md.includes(c.text), `claim ${c.id} missing from the markdown`);
  assert.match(md, /`✓` verified against the code/, 'the legend explains the markers');
  assert.match(md, /Deliberately not covered/);
  assert.match(md, /Noticed and unaccounted for/);
  // Anchors that were never checked must not read as verified in a file that
  // will be read far from the build that produced it.
  assert.ok(md.includes('unverifiable'), 'unchecked anchors are marked');
});

test('git: porcelain parsing covers renames, staged edits and untracked files', () => {
  const run = (args) => {
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return 'abc1234def5678\n';
    if (args[0] === 'rev-parse' && args[1] === '--show-prefix') return 'sub/dir/\n';
    if (args[0] === 'status') return ' M sub/dir/a.ts\nA  sub/dir/b.ts\n?? outside.ts\nR  sub/dir/old.ts -> sub/dir/new.ts\n';
    if (args[0] === 'diff') return 'sub/dir/c.ts\nother/d.ts\n';
    return null;
  };
  assert.equal(head(run), 'abc1234def5678');
  assert.equal(shortSha(head(run)), 'abc1234');

  const pre = gitPrefix(run);
  assert.equal(pre, 'sub/dir/');

  // Paths come back relative to the repo root; anchors resolve from --repo.
  const dirty = underPrefix(dirtyPaths(run), pre);
  assert.deepEqual([...dirty].sort(), ['a.ts', 'b.ts', 'new.ts', 'old.ts']);
  assert.ok(!dirty.has('outside.ts'), 'a path outside --repo is not an anchor path');

  const changed = underPrefix(changedSince(run, 'aaa'), pre);
  assert.deepEqual([...changed], ['c.ts']);

  // Every failure is "unknown", never "nothing changed".
  const dead = () => null;
  assert.equal(head(dead), null);
  assert.equal(dirtyPaths(dead), null);
  assert.equal(changedSince(dead, 'aaa'), null);
  assert.equal(changedSince(run, null), null);
});

test('incremental: reuse only where it is provably safe', () => {
  const claims = [
    { id: 'a', source: { kind: 'anchored', path: 'a.ts', hash: 'a'.repeat(12) } },
    { id: 'b', source: { kind: 'anchored', path: 'b.ts', hash: 'b'.repeat(12) } },
    { id: 'c', source: { kind: 'asserted', by: 'x', at: '2026-01-01' } },
  ];
  const lock = {
    schema_version: 1,
    artifact: 'docs-lock',
    commit: 'old1234567',
    claims: {
      a: { state: 'match', hash: 'a'.repeat(12), commit: 'old1234567' },
      b: { state: 'match', hash: 'b'.repeat(12), commit: 'old1234567' },
    },
  };
  const plan = (over) => planCheck({ claims, lock, commit: 'new7654321', changed: new Set(), dirty: new Set(), ...over });

  assert.deepEqual([...plan({}).recheck], [], 'nothing moved, nothing re-read');
  assert.deepEqual([...plan({ changed: new Set(['a.ts']) }).recheck], ['a'], 'a committed change');
  assert.deepEqual([...plan({ dirty: new Set(['b.ts']) }).recheck], ['b'], 'an uncommitted change');

  // Assertions are never in the plan: they expire on a clock, not on a file.
  assert.ok(!plan({}).reuse.has('c') && !plan({}).recheck.has('c'));

  // Re-anchoring the spec invalidates the lock entry for that claim.
  const reanchored = structuredClone(claims);
  reanchored[0].source.hash = 'f'.repeat(12);
  assert.deepEqual([...planCheck({ claims: reanchored, lock, commit: 'new7654321', changed: new Set(), dirty: new Set() }).recheck], ['a']);

  // A claim that did not verify last time keeps being re-read until it does.
  const stuck = structuredClone(lock);
  stuck.claims.a.state = 'changed';
  assert.deepEqual([...planCheck({ claims, lock: stuck, commit: 'new7654321', changed: new Set(), dirty: new Set() }).recheck], ['a']);

  // Every unknown resolves toward checking more.
  for (const over of [{ lock: null }, { commit: null }, { changed: null }, { dirty: null }]) {
    assert.deepEqual([...plan(over).recheck].sort(), ['a', 'b'], `expected a full check for ${JSON.stringify(Object.keys(over))}`);
  }
});

test('incremental: the commit a claim verified at survives a build that reused it', () => {
  const claims = [{ id: 'a', source: { kind: 'anchored', path: 'a.ts', hash: 'a'.repeat(12) } }];
  const first = mergeLock({ claims, lock: null, statuses: new Map([['a', { state: 'match' }]]), commit: 'aaa111', now: NOW });
  assert.equal(first.claims.a.commit, 'aaa111');
  assert.equal(first.commit, 'aaa111');

  // Later build at a new commit which reused the previous result.
  const reused = mergeLock({ claims, lock: first, statuses: new Map([['a', { state: 'match', commit: 'aaa111', reused: true }]]), commit: 'bbb222', now: NOW });
  assert.equal(reused.claims.a.commit, 'aaa111', 'still reports when it was actually verified');
  assert.equal(reused.commit, 'bbb222', 'while the lock itself moves forward');

  // A claim that stops matching keeps its last-good commit rather than claiming the new one.
  const broke = mergeLock({ claims, lock: reused, statuses: new Map([['a', { state: 'changed', detail: 'a.ts changed' }]]), commit: 'ccc333', now: NOW });
  assert.equal(broke.claims.a.commit, 'aaa111');
  assert.equal(broke.claims.a.state, 'changed');
  assert.deepEqual([...verifiedCommits(broke).keys()], [], 'a non-matching claim reports no verified commit');
});

test('topic document: gaps are reported only for specs it derives facts from', () => {
  const specs = coveredSpecs();
  const topic = json('examples/auth.docs.json');

  // A topic doc cites a handful of subjects and generates nothing structural.
  const t = buildGraph(topic, { specs, now: NOW });
  assert.ok(!t.coverage.unknown.some((u) => /subjects have no claim/.test(u.what)),
    `a focused document should not be nagged: ${JSON.stringify(t.coverage.unknown)}`);
  assert.ok(t.coverage.specs.every((s) => s.generated === false), 'read only to resolve references');
  assert.ok(t.coverage.out_of_scope.length >= 4, 'it carries its boundary instead');

  // The system overview does generate, so its gaps are real and still reported.
  const sys = buildGraph(docsExample(), { specs, now: NOW });
  assert.ok(sys.coverage.unknown.some((u) => /subjects have no claim/.test(u.what)));
  assert.ok(sys.coverage.specs.some((s) => s.generated === true));
});

test('markdown export is free of raw HTML, so it survives a paste into Confluence', () => {
  const md = toMarkdown(buildGraph(json('examples/auth.docs.json'), { specs: coveredSpecs(), now: NOW }));

  // Anything a foreign renderer would show as literal text is a defect here.
  const tag = md.match(/<\/?[a-zA-Z][^>\n]*>/);
  assert.equal(tag, null, `raw HTML would not render: ${tag && tag[0]}`);

  assert.match(md, /^# How authentication works/m);
  assert.match(md, /^## Where identity is established/m);
  assert.match(md, /^### Evidence/m);
  assert.match(md, /Do not read an absence as a "no"/);
  // A citation becomes the cited claim's mark, inline, with no dangling anchor link.
  assert.ok(!md.includes('[['), 'citations resolved');
  assert.ok(!/\(#[a-z0-9-]+\)/.test(md), 'no in-page anchors that a wiki would break');
  // The asserted claim keeps the person's name on it.
  assert.match(md, /stated by ana@example\.com on 2026-09-19/);
});

// ------------------------------------------------------------------- intake

test('intake: a link is built only for hosts whose issue form we actually know', () => {
  const t = (url) => issueUrl({ repository: { url }, intent: 'doc-request', title: 'x' });
  assert.match(t('https://github.com/acme/thing'), /^https:\/\/github\.com\/acme\/thing\/issues\/new\?/);
  assert.match(t('https://github.com/acme/thing.git'), /github\.com\/acme\/thing\/issues\/new/, '.git suffix trimmed');
  assert.match(t('https://gitlab.com/acme/thing/'), /gitlab\.com\/acme\/thing\/-\/issues\/new/);

  // A self-hosted host gets no link rather than one that opens a 404.
  assert.equal(t('https://git.internal.corp/acme/thing'), null);
  assert.equal(t('git@github.com:acme/thing.git'), null);
  assert.equal(issueUrl({ intent: 'doc-request', title: 'x' }), null);
});

test('intake: the body carries machine-readable context, and stays inside URL limits', () => {
  const url = issueUrl({
    repository: { url: 'https://github.com/acme/thing', revision: 'abc1234' },
    intent: 'doc-problem',
    title: 'Claim looks wrong',
    note: 'The TTL is twelve hours, not two.',
    context: { document: 'relay.docs', claim: 'session.ttl', confidence: 'verified', spec: 'relay.c4#bff', commit: 'abc1234' },
  });
  const body = new URL(url).searchParams.get('body');

  assert.ok(body.includes('The TTL is twelve hours, not two.'), 'the human note survives');
  assert.match(body, /```vibex\n[\s\S]*```/, 'the context is fenced so an agent can find it');
  for (const line of ['intent: doc-problem', 'claim: session.ttl', 'spec: relay.c4#bff', 'commit: abc1234']) {
    assert.ok(body.includes(line), `missing ${line}`);
  }
  assert.equal(new URL(url).searchParams.get('labels'), 'docs,intake');

  // A runaway note must not produce a URL a browser will truncate.
  const huge = issueUrl({ repository: { url: 'https://github.com/acme/thing' }, intent: 'doc-problem', title: 'x', note: 'y'.repeat(20000) });
  assert.ok(huge.length < 8000, `url was ${huge.length} characters`);

  assert.deepEqual(contextBlock({}), '', 'no context means no empty fence');
});

test('intake: every claim and the diagram details panel offer a way to report', () => {
  const graph = buildGraph(docsExample(), { specs: coveredSpecs(), now: NOW });
  const withRepo = {
    ...graph,
    project: { ...graph.project, repository: { url: 'https://github.com/acme/thing', revision: 'abc1234' } },
  };
  const html = renderDocsPanel(withRepo);
  assert.equal((html.match(/class="flag"/g) || []).length, withRepo.claims.length, 'one per claim');
  assert.ok(html.includes('class="seg ask"'), 'the toolbar offers the intents that are not about one claim');
  // Parse the hrefs rather than matching encoded text: URLSearchParams spells a
  // space as "+", which a naive encodeURIComponent check would miss.
  const intents = [...html.matchAll(/href="(https:\/\/github\.com[^"]*issues\/new[^"]*)"/g)]
    .map((m) => new URL(m[1].replace(/&amp;/g, '&')).searchParams.get('body'))
    .map((body) => (body.match(/intent: ([\w-]+)/) || [])[1]);
  for (const intent of ['doc-request', 'spec-gap', 'proposal', 'doc-problem']) {
    assert.ok(intents.includes(intent), `no link carries intent ${intent}`);
  }

  // No repository configured, no links — rather than links that go nowhere.
  const bare = renderDocsPanel(buildGraph(docsExample(), { specs: coveredSpecs(), now: NOW }));
  assert.ok(!bare.includes('class="flag"'));
  assert.ok(!bare.includes('class="seg ask"'));

  // The viewer builds the node-level link client-side from the same config.
  const viewer = read('assets/viewer.js');
  assert.ok(viewer.includes('intent: spec-gap'), 'node reports carry their own intent');
  assert.ok(viewer.includes('encodeURIComponent'), 'and are encoded');
});

// ------------------------------------------------------------- proposals

test('proposals: nothing in one can be verified, and the flag is visible everywhere', () => {
  const spec = docsExample();
  spec.meta.proposed = true;
  spec.meta.proposal = { by: 'ana@example.com', at: '2026-09-19', summary: 'A second region', issue: 'https://github.com/acme/thing/issues/1' };
  for (const c of spec.claims) if (c.source.kind === 'anchored') c.source = { kind: 'asserted', by: 'ana@example.com', at: '2026-09-19' };

  const graph = buildGraph(spec, { specs: coveredSpecs(), now: NOW });
  assert.equal(graph.coverage.counts.verified, 0, 'a proposal verifies nothing');
  assert.equal(graph.coverage.counts.proposed, graph.coverage.counts.claims, 'every claim is marked');
  assert.equal(graph.project.proposed, true);

  const html = renderDocsPanel(graph);
  assert.match(html, /This is a proposal\. Nothing described here exists\./);
  assert.match(html, /A second region/, 'the summary is shown');
  assert.ok(html.includes('type-badge proposed'));
  // The one sentence a proposal must never print.
  assert.ok(!/check out against the code/.test(html), 'a proposal cannot claim to check out against code');
  assert.match(html, /describe something that does not exist/);

  const md = toMarkdown(graph);
  assert.match(md, /\*\*This is a proposal\. Nothing described here exists\.\*\*/);
  assert.ok(!/✓ /.test(md.split('## ')[1] || ''), 'no verified ticks in a proposal');
});

test('proposals: anchoring one to code is an error, and an untraced one is warned about', () => {
  const spec = docsExample();
  spec.meta.proposed = true;
  const report = validateSpec(spec);
  assert.ok(report.errors.some((e) => e.code === 'anchored-proposal'), 'cannot anchor a proposal to code that does not exist');
  assert.ok(report.warnings.some((w) => w.code === 'untraced-proposal'), 'a proposal with no trail is warned about');

  // The reverse mistake: a trail set but the flag forgotten, so it renders as real.
  const sneaky = docsExample();
  sneaky.meta.proposal = { by: 'ana@example.com' };
  assert.ok(validateSpec(sneaky).warnings.some((w) => w.code === 'proposal-without-flag'));
});

test('proposals: a real document derives proposed facts from a proposed spec', () => {
  const specs = coveredSpecs();
  const c4 = specs.get('shop.c4');
  specs.set('shop.c4', { ...c4, meta: { ...c4.meta, proposed: true, proposal: { by: 'x', at: '2026-09-19' } } });

  const graph = buildGraph(docsExample(), { specs, now: NOW });
  const fromProposed = graph.claims.filter((c) => c.source.kind === 'derived' && c.source.spec === 'shop.c4');
  assert.ok(fromProposed.length > 0);
  for (const c of fromProposed) assert.equal(c.confidence, 'proposed', `${c.id} should not read as verified`);
  assert.deepEqual(graph.coverage.proposed_specs, ['shop.c4']);

  // Facts derived from the real specs are unaffected.
  assert.ok(graph.claims.some((c) => c.source.spec === 'orders.erd' && c.confidence === 'verified'));
});

// --------------------------------------------------------------- triage

test('triage: a precise refusal beats a confident guess', () => {
  const graph = { claims: [{ id: 'session.ttl', subject: 'shop.c4#bff', confidence: 'verified' }] };
  const specIds = new Set(['shop.c4', 'orders.erd']);
  const body = (block, prose = 'The TTL says twelve hours but the constant is two hours.') =>
    `${prose}\n\n\`\`\`vibex\n${block}\n\`\`\``;

  // Resolves against what exists now, not what the page said when it rendered.
  const ok = triage(parseIntake(body('intent: doc-problem\nclaim: session.ttl')), { graph, specIds });
  assert.equal(ok.action, 'act');
  assert.equal(ok.target.id, 'session.ttl');

  const renamed = triage(parseIntake(body('intent: doc-problem\nclaim: gone.away')), { graph, specIds });
  assert.equal(renamed.action, 'ask');
  assert.match(renamed.reply, /gone\.away/, 'the reply names what it could not find');

  const wrongSpec = triage(parseIntake(body('intent: spec-gap\nspec: nope.erd#x')), { graph, specIds });
  assert.equal(wrongSpec.action, 'ask');
  assert.match(wrongSpec.reply, /nope\.erd/);

  // A proposal with no stated problem is a sketch; drawing it would lend it standing.
  const sketch = triage(parseIntake(body('intent: proposal', 'Split the monolith into three services.')), { specIds });
  assert.equal(sketch.action, 'ask');
  assert.match(sketch.reply, /What problem/);
  const reasoned = triage(parseIntake(body('intent: proposal', 'Split it up so that a deploy of one does not stop the others.')), { specIds });
  assert.equal(reasoned.action, 'act');

  // An issue that is not intake is left alone entirely.
  assert.equal(triage(parseIntake('the build is broken on node 18'), {}).action, 'ignore');
  // Labelled intake but unintelligible: answered, not ignored and not guessed at.
  assert.equal(triage(parseIntake('halp'), { labels: ['intake'] }).action, 'ask');
});

test('triage: a fenced block in an issue is input to check, not a fact to trust', () => {
  const forged = parseIntake('```vibex\nintent: doc-problem\nclaim: ../../etc/passwd\n```\nSomething is wrong with this claim I promise.');
  assert.equal(forged.context.claim, '../../etc/passwd');
  // It is looked up like any other id and simply does not exist.
  const out = triage(forged, { graph: { claims: [] } });
  assert.equal(out.action, 'ask');

  // Absurd input cannot blow up the parser.
  assert.doesNotThrow(() => parseIntake('```vibex\n' + 'a: b\n'.repeat(5000) + '```'));
  assert.equal(parseIntake('').intent, null);
  assert.equal(parseIntake(undefined).hadBlock, false);
});

// ------------------------------------------------------------- changelog

// A scripted history, so the parser is tested rather than this repository.
function fakeGit(log) {
  const US = String.fromCharCode(31); const RS = String.fromCharCode(30);
  return (args) => {
    if (args[0] === 'rev-parse') return `${args[1]}0000000000000000000000000000000000`.slice(0, 40);
    if (args[0] === 'remote') return 'https://github.com/acme/thing.git\n';
    if (args[0] !== 'log') return null;
    return log.map((c) => `${RS}${c.sha}${US}${c.author}${US}${c.at}${US}${c.subject}${US}${c.body || ''}${US}${(c.paths || []).join('\n')}`).join('');
  };
}

test('changelog: conventional prefixes are honoured, and their absence is admitted', () => {
  const conventional = readCommits(fakeGit([
    { sha: 'a'.repeat(40), author: 'Ana', at: '2026-09-19T00:00:00Z', subject: 'feat(docs): add a thing', paths: ['renderers/x.mjs'] },
    { sha: 'b'.repeat(40), author: 'Ana', at: '2026-09-19T00:00:00Z', subject: 'fix!: break it properly', paths: ['bin/vibex.mjs'] },
  ]), 'v1', 'HEAD');
  const log = buildChangelog({ commits: conventional, from: 'v1', to: 'HEAD', now: NOW });
  assert.equal(log.impact.grouping, 'mixed', 'the author said what these were');
  // feat(docs) is a feature scoped to docs, so it belongs under Added: the type
  // decides the section and the scope is only a label.
  assert.deepEqual(log.sections.map((s) => s.id).sort(), ['added', 'breaking']);
  assert.equal(log.entries.find((e) => e.short === 'bbbbbbb').breaking, true);
  assert.equal(log.entries[0].scope, 'docs');

  // Prose history: the section is a guess, and the artefact says so.
  const prose = readCommits(fakeGit([
    { sha: 'c'.repeat(40), author: 'Ana', at: '2026-09-19T00:00:00Z', subject: 'Give ERD edges their own lanes', paths: ['renderers/erd/render-erd.mjs', '.github/workflows/ci.yml'] },
  ]), 'v1', 'HEAD');
  const guessed = buildChangelog({ commits: prose, from: 'v1', to: 'HEAD', now: NOW });
  assert.equal(guessed.impact.grouping, 'inferred');
  assert.equal(guessed.entries[0].grouped_by, 'paths');
  // Touching a workflow alongside a renderer does not make a commit internal.
  assert.equal(guessed.entries[0].section, 'changed');

  const md = changelogToMarkdown(guessed, { repository: { url: 'https://github.com/acme/thing' } });
  assert.match(md, /inferred from the files each commit touched/, 'the reader is told it is a guess');
});

test('changelog: only paths that are entirely internal make a commit internal', () => {
  const only = (paths) => buildChangelog({
    commits: readCommits(fakeGit([{ sha: 'd'.repeat(40), author: 'A', at: '2026-09-19T00:00:00Z', subject: 'x', paths }]), 'v1', 'HEAD'),
    from: 'v1', to: 'HEAD', now: NOW,
  }).entries[0].section;

  assert.equal(only(['test/a.test.mjs', '.github/workflows/ci.yml']), 'internal');
  assert.equal(only(['showcase/relay.c4.json']), 'internal');
  assert.equal(only(['test/a.test.mjs', 'renderers/x.mjs']), 'changed');
  assert.equal(only(['SKILL.md', 'README.md']), 'docs');
  assert.equal(only([]), 'changed');
});

test('changelog: a spec file in the diff is named, and the range is recorded', () => {
  const commits = readCommits(fakeGit([
    { sha: 'e'.repeat(40), author: 'Ana', at: '2026-09-19T00:00:00Z', subject: 'x', paths: ['docs/arch/orders.erd.json', 'docs/arch/auth.docs.json', 'src/unrelated.ts'] },
  ]), 'v1', 'HEAD');
  const log = buildChangelog({ commits, from: 'v1', to: 'HEAD', fromCommit: 'f'.repeat(40), toCommit: '0'.repeat(40), now: NOW });
  assert.deepEqual(log.entries[0].specs.sort(), ['auth.docs', 'orders.erd']);
  assert.deepEqual(log.impact.specs_changed, ['auth.docs', 'orders.erd']);
  assert.equal(log.range.from, 'v1');
  assert.equal(log.range.from_commit.length, 40);
});

test('changelog: what a release did to the documentation separates written from computed', () => {
  const asserted = (id, text) => ({ id, text, source: { kind: 'asserted', by: 'a', at: '2026-01-01' } });
  const derived = (id, text) => ({ id, text, source: { kind: 'derived', spec: 's', rule: 'r' } });

  const before = [asserted('kept', 'unchanged'), asserted('gone', 'removed later'), asserted('reword', 'old wording'), derived('d1', 'x')];
  const after = [
    asserted('kept', 'unchanged'),
    asserted('reword', 'new wording'),
    asserted('fresh', 'brand new'),
    { ...asserted('replacement', 'takes over'), supersedes: 'gone' },
    derived('d2', 'y'), derived('d3', 'z'),
  ];
  const d = diffClaims(before, after);

  assert.deepEqual(d.added.sort(), ['fresh', 'replacement'], 'only written claims are listed');
  assert.deepEqual(d.removed, ['gone']);
  assert.deepEqual(d.superseded, [{ id: 'replacement', replaces: 'gone' }]);
  assert.deepEqual(d.reworded.map((c) => c.id), ['reword']);
  assert.equal(d.derived_added, 2, 'computed facts are counted, not named');
  assert.equal(d.derived_removed, 1);

  const md = changelogToMarkdown(
    buildChangelog({ commits: [], from: 'v1', to: 'v2', now: NOW, claimDiff: d }),
    { repository: { url: 'https://github.com/acme/thing' } },
  );
  assert.match(md, /2 derived facts appeared and 1 disappeared/);
  assert.match(md, /check these were meant to go, not lost in a rewrite/);
  // It travels, so no raw HTML beyond the one generated-by line.
  assert.equal((md.match(/<\/?[a-zA-Z][^>\n]*>/g) || []).filter((t) => !/^<\/?sub>$/.test(t)).length, 0);
});

test('changelog: git failing is unknown, never "nothing changed"', () => {
  const dead = () => null;
  assert.equal(readCommits(dead, 'v1', 'HEAD'), null);
  assert.equal(resolveRef(dead, 'HEAD'), null);

  // A long list of ids stops being information; the markdown caps it.
  const many = Array.from({ length: 40 }, (_, i) => `claim.${i}`);
  const md = changelogToMarkdown(buildChangelog({
    commits: [], from: 'v1', to: 'v2', now: NOW,
    claimDiff: { added: many, removed: [], superseded: [], reworded: [], derived_added: 0, derived_removed: 0 },
  }), {});
  assert.match(md, /and 28 more/);
  assert.ok(!md.includes('claim.39'), 'the tail is summarised, not printed');
});

test('changelog panel: it sits beside the diagrams it names, and links to the right history', () => {
  const log = buildChangelog({
    commits: readCommits(fakeGit([
      { sha: 'a'.repeat(40), author: 'Ana', at: '2026-09-19T00:00:00Z', subject: 'fix!: change the shape', body: 'why it happened\n\nCo-Authored-By: Someone <x@y.z>', paths: ['docs/orders.erd.json'] },
    ]), 'v1', 'HEAD'),
    from: 'v1',
    to: 'HEAD',
    now: NOW,
    // The commits came from here; a spec may describe an entirely different system.
    repository: { url: 'https://github.com/acme/tool.git' },
    claimDiff: { added: ['a'], removed: ['b'], superseded: [], reworded: [{ id: 'c', was: 'twelve hours', now: 'two hours' }], derived_added: 3, derived_removed: 0 },
  });

  const html = renderChangelogPanel(log, {
    repository: { url: 'https://github.com/someone/else' },
    resolveSpec: (id) => (id === 'orders.erd' ? { panel: 2, label: 'Orders domain' } : null),
  });

  assert.ok(html.includes('data-panel="changelog"'));
  assert.match(html, /github\.com\/acme\/tool\/commit\/a{40}/, 'links follow the commits, not the specs');
  assert.ok(!html.includes('someone/else'), 'the spec repository does not win');

  // The chip is the reason this belongs in the dashboard at all.
  assert.match(html, /data-goto-panel="2"[^>]*>Orders domain/);
  // A rewording is shown as the change it was, not as a bare id.
  assert.match(html, /twelve hours[\s\S]*two hours/);
  assert.match(html, /check these were meant to go/);
  assert.match(html, /3 derived fact/);
  // A trailer is noise in a changelog.
  assert.ok(!html.includes('Co-Authored-By'));
  // This fixture uses a conventional prefix, so the section is the author's
  // intent and carries no guess badge — and it is marked breaking.
  assert.ok(!html.includes('sorted by paths'));
  assert.match(html, /class="cl-entry breaking"/);

  // A prose commit does get the badge, and the aside explains it.
  const guessed = renderChangelogPanel(buildChangelog({
    commits: readCommits(fakeGit([
      { sha: 'c'.repeat(40), author: 'Ana', at: '2026-09-19T00:00:00Z', subject: 'just some words', paths: ['src/x.ts'] },
    ]), 'v1', 'HEAD'),
    from: 'v1', to: 'HEAD', now: NOW,
  }), {});
  assert.match(guessed, /sorted by paths/);
  assert.match(guessed, /not from its message/);

  assert.match(changelogNavHtml(log), /data-panel="changelog"/);
});

test('changelog panel: the dashboard shows one when a changelog artefact is supplied', () => {
  const items = DIAGRAM_EXAMPLES.map((n) => ({ file: n.replace(/\.json$/, ''), spec: json(`examples/${n}`) }));
  const changelog = buildChangelog({
    commits: readCommits(fakeGit([
      { sha: 'b'.repeat(40), author: 'Ana', at: '2026-09-19T00:00:00Z', subject: 'touch the data model', paths: ['examples/orders.erd.json'] },
    ]), 'v1', 'HEAD'),
    from: 'v1', to: 'HEAD', now: NOW,
  });

  const withLog = renderDashboard(items, { title: 'T', changelog });
  assert.ok(withLog.html.includes('data-panel="changelog"'));
  const erd = withLog.entries.find((e) => e.spec.diagram_type === 'erd');
  assert.ok(withLog.html.includes(`data-goto-panel="${erd.index}"`), 'the touched spec resolves to its panel');

  // Without one, nothing changes: the panel is additive.
  const without = renderDashboard(items, { title: 'T' });
  assert.ok(!without.html.includes('data-panel="changelog"'));
  assert.equal(without.entries.length, withLog.entries.length, 'it takes no diagram slot');
});

test('layout: no edge label is drawn on top of a node, in any diagram we ship', () => {
  // The SVG carries absolute coordinates, so this needs no browser: pull the
  // rects straight out and check them against each other.
  const attr = (tag, name) => {
    const m = new RegExp(`\\\\b${name}="(-?[\\\\d.]+)"`).exec(tag);
    return m ? Number(m[1]) : null;
  };
  const rects = (svg, cls) => [...svg.matchAll(/<rect\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => new RegExp(`class="[^"]*\\\\b${cls}\\\\b`).test(tag))
    .map((tag) => ({ x: attr(tag, 'x'), y: attr(tag, 'y'), w: attr(tag, 'width'), h: attr(tag, 'height') }))
    .filter((r) => r.x !== null && r.w);

  const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  // The wide diagrams that used to stress this live in the website repository
  // now, which runs the same check over the rendered showcase. What ships in
  // the package is what has to hold here.
  const specs = DIAGRAM_EXAMPLES.map((n) => `examples/${n}`);
  assert.ok(specs.length >= 4, `expected one example per diagram type, saw ${specs.length}`);

  for (const file of specs) {
    const { html, report } = renderSpec(json(file));
    assert.ok(report.ok, `${file} does not validate`);
    const svg = html.slice(html.indexOf('<svg'), html.indexOf('</svg>'));

    const boxes = rects(svg, 'box');
    const labels = rects(svg, 'label-bg');
    if (!labels.length) continue;

    const onBox = labels.filter((l) => boxes.some((b) => hit(l, b)));
    assert.equal(onBox.length, 0, `${file}: ${onBox.length} of ${labels.length} labels sit on a node`);

    const onLabel = labels.filter((a, i) => labels.some((b, j) => j !== i && hit(a, b)));
    assert.equal(onLabel.length, 0, `${file}: ${onLabel.length} labels overlap each other`);
  }
});

test('layout: the least-bad position is chosen when every candidate collides', () => {
  // Boxed in on all sides, so no free spot exists and the fallback must choose.
  const wall = (x, y, w, h) => ({ x, y, w, h });
  const obstacles = [];
  for (let x = -400; x <= 400; x += 40) {
    for (let y = -400; y <= 400; y += 40) obstacles.push(wall(x, y, 38, 38));
  }
  // One gap, deliberately off to the side: the label should find it.
  const gap = obstacles.findIndex((o) => o.x === 200 && o.y === 0);
  obstacles.splice(gap, 1);

  const box = placeLabel([[0, 0], [400, 0]], 30, 20, obstacles);
  assert.ok(box.w === 30 && box.h === 20, 'it still returns a box of the right size');
  const worst = obstacles.reduce((sum, o) => sum + overlapArea(box, o), 0);
  const centre = { x: 200 - 15, y: 0 - 10, w: 30, h: 20 };
  const centreCost = obstacles.reduce((sum, o) => sum + overlapArea(centre, o), 0);
  assert.ok(worst <= centreCost, `fallback took a worse spot than the midpoint (${worst} vs ${centreCost})`);

  // The measure itself.
  assert.equal(overlapArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }), 25);
  assert.equal(overlapArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 }), 0);
});

// The release checklist asked a human to keep these two in step, which is the
// kind of rule that holds until the one release nobody is concentrating on.
// The skill reports its own version to agents; the package reports it to npm.
// A mismatch means one of them is lying and nothing else notices.
test('release: package.json and SKILL.md declare the same version', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const skill = /\n {2}version: "([^"]+)"/.exec(fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8'));
  assert.ok(skill, 'SKILL.md declares metadata.version');
  assert.equal(skill[1], pkg, `SKILL.md says ${skill?.[1]}, package.json says ${pkg}`);
});

test('release: the changelog has a section for the version being shipped', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const log = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(log, new RegExp(`^## \\[${pkg.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}`, 'm'),
    `CHANGELOG.md has no dated section for ${pkg}`);
});
