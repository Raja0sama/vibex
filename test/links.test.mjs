import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateSpec } from '../renderers/shared/validate.mjs';
import { checkLinks, reanchorLinks } from '../renderers/links/check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const shop = () => json('examples/shop.links.json');
const endpoints = new Map([['shop.endpoints', json('examples/shop.endpoints.json')]]);
const withC4 = (c4 = json('examples/shop.c4.json')) => new Map([...endpoints, ['shop.c4', c4]]);
const reader = (dir) => (rel) => { try { return fs.readFileSync(path.join(root, dir, rel), 'utf8'); } catch { return null; } };
const multiRepo = (name) => ({ bff: reader('examples/shop-repo/bff'), 'order-api': reader('examples/shop-repo/order-api') })[name] || null;
const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'bin/vibex.mjs'), ...args], { cwd: root, encoding: 'utf8' });
const codes = (spec) => validateSpec(spec).errors.map((e) => e.code);

test('links: the shop example validates and every call checks out across two repos', () => {
  assert.deepEqual(validateSpec(shop()).errors, []);
  const r = checkLinks(shop(), { readerFor: multiRepo, specs: withC4() });
  assert.deepEqual(r.counts, { links: 5, ok: 5, broken: 0, uncalled: 6, drift: 0 });
  assert.deepEqual(r.diagrams, [{ spec: 'shop.c4', unbacked: [], missing: [], undrawn: [] }]);
  assert.equal(r.links.find((l) => l.id === 'stripe-webhook').client.state, 'external');
  assert.ok(r.uncalled.some((u) => u.endpoint === 'shop.endpoints#admin-refund'), 'endpoints nothing calls are listed');
});

test('links: a monorepo uses one --repo and root-relative paths', () => {
  const spec = shop();
  for (const s of spec.services) delete s.repo;
  const dir = { bff: 'bff', order_api: 'order-api' };
  for (const l of spec.links) {
    if (l.client) l.client.path = `${dir[l.from]}/${l.client.path}`;
    if (l.handler) l.handler.path = `${dir[l.to]}/${l.handler.path}`;
  }
  const r = checkLinks(spec, { readerFor: (name) => (name === '' ? reader('examples/shop-repo') : null), specs: endpoints });
  assert.equal(r.counts.broken, 0);
});

test('links: a changed handler, a missing repo and a dangling endpoint are each reported', () => {
  const moved = (name) => (name === 'order-api'
    ? (rel) => reader('examples/shop-repo/order-api')(rel)?.replace("@Post(':id/cancel')", "@Post(':id/void')")
    : multiRepo(name));
  const spec = shop();
  spec.links[0].endpoint = 'shop.endpoints#no-such-endpoint';
  const r = checkLinks(spec, { readerFor: moved, specs: endpoints });
  const byId = Object.fromEntries(r.links.map((l) => [l.id, l]));
  assert.equal(byId['bff-cancel-order'].handler.state, 'changed');
  assert.equal(byId['bff-create-order'].handler.state, 'match', 'only the moved region flags');
  assert.equal(byId['bff-list-orders'].endpoint.state, 'dangling');
  assert.equal(checkLinks(shop(), { readerFor: (n) => (n === 'bff' ? multiRepo(n) : null), specs: endpoints }).links[0].handler.state, 'no-repo');
});

test('links: reanchor rewrites only moved or placeholder hashes', () => {
  const spec = shop();
  const before = JSON.stringify(spec.links[1]);
  spec.links[0].client.hash = '000000000000';
  const r = checkLinks(spec, { readerFor: multiRepo, specs: endpoints });
  assert.equal(r.links[0].client.state, 'unhashed');
  assert.equal(reanchorLinks(spec, r), 1);
  assert.equal(spec.links[0].client.hash, shop().links[0].client.hash);
  assert.equal(JSON.stringify(spec.links[1]), before);
});

test('links: the validator catches references that cannot be right', () => {
  const s = shop();
  s.links[0].from = 'nope';
  s.links[1].to = 'bff';
  s.links[1].from = 'bff';
  delete s.links[2].client;
  s.links.find((l) => l.id === 'stripe-webhook').endpoint = 'not a ref';
  s.shared_ids[0].used_by = ['ghost'];
  const c = codes(s);
  assert.ok(c.includes('dangling-ref') && c.includes('self-link') && c.includes('missing') && c.includes('ref'), c.join(','));
  const extern = shop();
  delete extern.links.find((l) => l.id === 'stripe-webhook').handler.hash;
  assert.ok(codes(extern).includes('hash'));
});

test('links: vibex links --check exits 1 on drift and 0 when clean', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibex-links-'));
  fs.cpSync(path.join(root, 'examples/shop-repo'), path.join(dir, 'repo'), { recursive: true });
  const repos = ['--repo', `bff=${path.join(dir, 'repo/bff')}`, '--repo', `order-api=${path.join(dir, 'repo/order-api')}`];
  const args = ['links', 'examples/shop.links.json', 'examples', ...repos, '--check'];
  assert.equal(cli(...args).status, 0);
  const ctl = path.join(dir, 'repo/order-api/src/orders/orders.controller.ts');
  fs.writeFileSync(ctl, fs.readFileSync(ctl, 'utf8').replace("@Get()", "@Get('mine')"));
  const out = cli(...args);
  assert.equal(out.status, 1);
  assert.match(out.stdout, /changed\s+bff-list-orders/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('links: drawn as a System view, first in a dashboard', async () => {
  const { renderDashboard } = await import('../renderers/shared/dashboard.mjs');
  const { renderSpec } = await import('../renderers/shared/render.mjs');
  const { html, entries, problems } = renderDashboard([{ file: 'orders.erd', spec: json('examples/orders.erd.json') }, { file: 'shop.links', spec: shop() }], { title: 'T' });
  assert.equal(problems.length, 0);
  assert.deepEqual(entries.map((e) => e.file), ['shop.links', 'orders.erd']);
  assert.match(html, /<h2>System<\/h2>/);
  const page = renderSpec(shop());
  assert.ok(page.html, 'renders on its own');
  for (const id of ['bff', 'order_api', 'stripe']) assert.match(page.html, new RegExp(`data-node-id="${id}"`));
  assert.match(page.html, /data-edge-id="bff--order_api"[^>]*data-edge-label="3 calls"/);
  const embedded = JSON.parse(/<script id="vibex-spec" type="application\/json">([\s\S]*?)<\/script>/.exec(page.html)[1]);
  assert.deepEqual(embedded.relationships.find((r) => r.id === 'bff--order_api').calls.map((c) => c.route), ['GET /orders', 'POST /orders', 'POST /orders/{id}/cancel']);
});

test('links: one templated call can reach several endpoints', () => {
  const spec = shop();
  spec.links[0].endpoint = ['shop.endpoints#list-orders', 'shop.endpoints#get-order'];
  const r = checkLinks(spec, { readerFor: multiRepo, specs: endpoints });
  assert.equal(r.links[0].endpoint.state, 'match');
  assert.ok(!r.uncalled.some((u) => u.endpoint === 'shop.endpoints#get-order'), 'both count as called');
  spec.links[0].endpoint.push('shop.endpoints#nope');
  assert.equal(checkLinks(spec, { readerFor: multiRepo, specs: endpoints }).links[0].endpoint.state, 'dangling');
  spec.links[0].endpoint = [];
  assert.ok(codes(spec).includes('ref'));
});

test('links: ignore patterns keep health and admin routes out of "nothing calls"', () => {
  const spec = shop();
  spec.services[1].ignore = ['/admin/**', '/orders/*/payments'];
  const r = checkLinks(spec, { readerFor: multiRepo, specs: endpoints });
  const routes = r.uncalled.map((u) => u.route);
  assert.ok(!routes.some((x) => x.includes('/admin/')), routes.join(','));
  assert.ok(!routes.includes('POST /orders/{id}/payments'));
  assert.ok(routes.includes('GET /orders/{id}'), '"*" stays inside one segment');
  spec.services[1].ignore = ['admin'];
  assert.ok(codes(spec).includes('type'));
});

test('links: a C4 that drifted from the links is reported three ways', () => {
  const c4 = json('examples/shop.c4.json');
  c4.relationships = c4.relationships.filter((r) => !(r.from === 'stripe' && r.to === 'order_api'));
  c4.relationships.push({ from: 'bff', to: 'stripe', label: 'Pays' });
  const d = checkLinks(shop(), { readerFor: multiRepo, specs: withC4(c4) }).diagrams[0];
  assert.deepEqual(d.missing, [{ from: 'stripe', to: 'order_api', links: 1 }], 'a call with no arrow');
  assert.deepEqual(d.unbacked, [{ from: 'bff', to: 'stripe' }], 'an arrow with no call');

  const noStripe = shop();
  delete noStripe.services[2].c4;
  const u = checkLinks(noStripe, { readerFor: multiRepo, specs: withC4() });
  assert.deepEqual(u.diagrams[0].undrawn.map((x) => x.absent), ['stripe', 'stripe'], 'a neighbour of a boxed service is not drawn');
  assert.equal(u.counts.drift, 2);
});

test('links: a C4 ref to a diagram that was not loaded says so', () => {
  const d = checkLinks(shop(), { readerFor: multiRepo, specs: endpoints }).diagrams[0];
  assert.match(d.error, /not loaded/);
  const bad = shop();
  bad.services[0].c4 = ['shop.c4'];
  assert.ok(codes(bad).includes('ref'));
});

test('links: only services inside a boundary need their neighbours drawn; two-way arrows count both ways', () => {
  const spec = shop();
  spec.services.push({ id: 'mailer', label: 'Mailer', external: true, c4: ['shop.c4#mail'] });
  spec.links.push({ id: 'stripe-mailer', from: 'stripe', to: 'mailer', kind: 'webhook', route: 'POST /receipts' });
  const d = checkLinks(spec, { readerFor: multiRepo, specs: withC4() }).diagrams[0];
  assert.deepEqual(d.undrawn, [], 'stripe sits outside every boundary, so its own neighbours are not this diagram\'s business');
  assert.deepEqual(d.missing, [], 'nor are arrows between two outside services');

  const c4 = json('examples/shop.c4.json');
  c4.relationships = c4.relationships.filter((r) => !(r.from === 'stripe' && r.to === 'order_api'));
  c4.relationships.find((r) => r.from === 'order_api' && r.to === 'stripe').direction = 'both';
  assert.deepEqual(checkLinks(shop(), { readerFor: multiRepo, specs: withC4(c4) }).diagrams[0].missing, []);
});

test('layout: a line that would cross a box goes around it, and a clear line is left alone', async () => {
  const { detour, routeHits } = await import('../renderers/shared/layout.mjs');
  const straight = [[0, 50], [300, 50]];
  const blocker = { x: 120, y: 20, w: 60, h: 60 };
  assert.deepEqual(detour(straight, []), straight);
  const around = detour(straight, [blocker]);
  assert.deepEqual(routeHits(around, [blocker]), []);
  assert.deepEqual(around[0], [0, 50]);
  assert.deepEqual(around[around.length - 1], [300, 50]);
  const second = { x: 120, y: -40, w: 60, h: 50 };
  assert.deepEqual(routeHits(detour(straight, [blocker, second]), [blocker, second]), [], 'a lane blocked by a neighbour moves past both');
});
