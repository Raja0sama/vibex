// Moving boxes by hand, in both output modes. Run: see linked.e2e.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderSpec } from '../../renderers/shared/render.mjs';
import { renderDashboard } from '../../renderers/shared/dashboard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

let chromium;
try { ({ chromium } = await import('playwright-core')); } catch { /* skipped below */ }
const skip = chromium ? false : 'playwright-core is not installed (npm i --no-save playwright-core)';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vibex-move-'));
const MODES = ['inline', 'linked'];
const url = { inline: {}, linked: {} };
for (const mode of MODES) {
  const linked = mode === 'linked';
  const dir = path.join(out, mode);
  fs.mkdirSync(dir, { recursive: true });
  const put = (name, { html, files }) => {
    fs.writeFileSync(path.join(dir, `${name}.html`), html);
    for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), c);
    url[mode][name] = pathToFileURL(path.join(dir, `${name}.html`)).href;
  };
  for (const name of ['orders.erd', 'shop.c4', 'shop.endpoints', 'order.lifecycle']) put(name, renderSpec(json(`examples/${name}.json`), { linked, name }));
  const items = ['orders.erd', 'shop.c4', 'shop.endpoints', 'order.lifecycle'].map((f) => ({ file: f, spec: json(`examples/${f}.json`) }));
  put('dashboard', renderDashboard(items, { title: 'Shop', linked, name: 'dashboard' }));
}

let browser;
before(async () => {
  if (skip) return;
  browser = await chromium.launch(process.env.VIBEX_CHROME ? { executablePath: process.env.VIBEX_CHROME } : { channel: 'chrome' });
});
after(async () => {
  await browser?.close();
  fs.rmSync(out, { recursive: true, force: true });
});

async function open(href) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  await page.goto(href);
  return { page, problems };
}

async function drag(page, locator, dx, dy) {
  const box = await locator.boundingBox();
  const x = box.x + Math.min(30, box.width / 2); const y = box.y + Math.min(12, box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

const layout = (scope) => scope.locator('svg.vibex').evaluate((svg) => ({
  nodes: Object.fromEntries([...svg.querySelectorAll('[data-node-id]')].map((n) => [n.dataset.nodeId, n.getAttribute('transform')])),
  edges: Object.fromEntries([...svg.querySelectorAll('.edge[data-edge-id]')].map((e) => [e.dataset.edgeId, { d: e.querySelector('path.line').getAttribute('d'), hit: e.querySelector('path.hit')?.getAttribute('d'), from: e.dataset.edgeFrom, to: e.dataset.edgeTo, t: e.getAttribute('transform') }])),
  labels: Object.fromEntries([...svg.querySelectorAll('.edge-label[data-edge-id]')].map((l) => [l.dataset.edgeId, l.getAttribute('transform')])),
  viewBox: svg.getAttribute('viewBox'),
}));

const ends = (d) => { const n = d.match(/-?\d*\.?\d+/g).map(Number); return [[n[0], n[1]], [n[n.length - 2], n[n.length - 1]]]; };
const nodeRect = (scope, id) => scope.locator(`svg.vibex [data-node-id="${id}"]`).evaluate((el) => {
  const shape = el.querySelector('rect.box, rect.frame') || el;
  const b = shape.getBBox();
  const m = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(el.getAttribute('transform') || '');
  const dx = m ? +m[1] : 0; const dy = m ? +m[2] : 0;
  return { x: b.x + dx, y: b.y + dy, w: b.width, h: b.height };
});
const onEdge = (p, r) => {
  const within = (v, lo, hi) => v >= lo - 0.6 && v <= hi + 0.6;
  const touchX = Math.abs(p[0] - r.x) < 0.6 || Math.abs(p[0] - (r.x + r.w)) < 0.6;
  const touchY = Math.abs(p[1] - r.y) < 0.6 || Math.abs(p[1] - (r.y + r.h)) < 0.6;
  return (touchX && within(p[1], r.y, r.y + r.h)) || (touchY && within(p[0], r.x, r.x + r.w));
};

for (const mode of MODES) {
  test(`${mode}: dragging an ERD table moves it, re-routes only its lines, and they still meet the table`, { skip }, async () => {
    const { page, problems } = await open(url[mode]['orders.erd']);
    await page.click('[data-role=zoom-fit]');
    const before = await layout(page);
    const id = 'order';
    await drag(page, page.locator(`svg.vibex [data-node-id="${id}"]`), 160, 90);
    const afterMove = await layout(page);

    assert.match(afterMove.nodes[id] || '', /^translate\(/, 'the table moved');
    for (const [other, t] of Object.entries(afterMove.nodes)) if (other !== id) assert.equal(t, null, `${other} stayed put`);
    const mine = Object.entries(before.edges).filter(([, e]) => (e.from === id) !== (e.to === id));
    assert.ok(mine.length > 3, 'the table has lines to re-route');
    const rect = await nodeRect(page, id);
    for (const [eid, e] of mine) {
      const now = afterMove.edges[eid];
      assert.notEqual(now.d, e.d, `${eid} re-routed`);
      assert.equal(now.hit, now.d, `${eid} click target follows the line`);
      const [start, end] = ends(now.d);
      assert.ok(onEdge(e.from === id ? start : end, rect), `${eid} still meets the moved table`);
      const otherRect = await nodeRect(page, e.from === id ? e.to : e.from);
      assert.ok(onEdge(e.from === id ? end : start, otherRect), `${eid} still meets the other table`);
      // The end on the table that did not move stays on the same column row
      // (or the same spot along a top/bottom side): the renderer chose it.
      const [s0, e0] = ends(e.d);
      const was = e.from === id ? e0 : s0; const is = e.from === id ? end : start;
      const side = (p) => (Math.abs(p[0] - otherRect.x) < 0.6 || Math.abs(p[0] - (otherRect.x + otherRect.w)) < 0.6 ? 'v' : 'h');
      if (side(was) === side(is)) assert.ok(Math.abs(side(is) === 'v' ? is[1] - was[1] : is[0] - was[0]) < 0.6, `${eid} keeps its attachment point (${was} → ${is})`);
      if (before.labels[eid] !== undefined) assert.match(afterMove.labels[eid] || '', /^translate\(/, `${eid} label follows`);
    }
    for (const [eid, e] of Object.entries(before.edges)) {
      if (e.from !== id && e.to !== id) assert.equal(afterMove.edges[eid].d, e.d, `${eid} untouched`);
    }

    // A press without movement is still a click: it selects, it does not move.
    await page.click('[data-role=zoom-fit]');
    const target = await page.locator('svg.vibex [data-node-id="product"] rect.box').boundingBox();
    await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);
    assert.equal((await layout(page)).nodes.product, null, 'a click does not move');
    assert.ok(!/Click a node/.test(await page.locator('[data-role=details]').innerText()), 'a click selects');

    assert.ok(await page.locator('[data-role=reset-layout]').isVisible(), 'reset offered once something moved');
    await page.locator('[data-role=reset-layout]').click();
    const reset = await layout(page);
    assert.deepEqual({ ...reset, viewBox: null }, { ...before, viewBox: null }, 'reset puts every box, line and label back exactly');
    assert.ok(await page.locator('[data-role=reset-layout]').isHidden(), 'reset hidden again');
    assert.deepEqual(problems, []);
    await page.close();
  });

  test(`${mode}: a move lasts until reload, and reload draws the original layout`, { skip }, async () => {
    const { page, problems } = await open(url[mode]['order.lifecycle']);
    await page.click('[data-role=zoom-fit]');
    const before = await layout(page);
    await drag(page, page.locator('svg.vibex [data-node-id="paid"]'), 0, 140);
    assert.notDeepEqual(await layout(page), before);
    await page.reload();
    await page.click('[data-role=zoom-fit]');
    assert.deepEqual(await layout(page), before, 'nothing carried over the reload');
    assert.equal(await page.evaluate(() => Object.keys(sessionStorage).length + Object.keys(localStorage).filter((k) => /layout|move/i.test(k)).length), 0, 'nothing written to storage');
    assert.deepEqual(problems, []);
    await page.close();
  });

  test(`${mode}: an endpoint row drags its whole card; a C4 boundary carries what is inside it`, { skip }, async () => {
    const { page, problems } = await open(url[mode]['shop.endpoints']);
    await page.click('[data-role=zoom-fit]');
    await drag(page, page.locator('svg.vibex [data-node-id="list-orders"]'), 90, 60);
    const eps = (await layout(page)).nodes;
    const movedEps = Object.keys(eps).filter((k) => eps[k]);
    assert.ok(movedEps.includes('orders') && movedEps.includes('list-orders') && movedEps.includes('create-order'), `card and its rows moved (${movedEps})`);
    assert.ok(new Set(movedEps.map((k) => eps[k])).size === 1, 'all by the same amount');
    assert.ok(movedEps.length < Object.keys(eps).length, 'other cards stayed');
    await page.close();

    const c4 = await open(url[mode]['shop.c4']);
    await c4.page.click('[data-role=zoom-fit]');
    const before = await layout(c4.page);
    await drag(c4.page, c4.page.locator('svg.vibex [data-node-kind=boundary][data-node-id="shop"] rect.tag'), 50, 40);
    const after = await layout(c4.page);
    const inside = Object.keys(after.nodes).filter((k) => after.nodes[k]);
    assert.ok(inside.includes('shop') && inside.includes('bff'), `boundary and contents moved (${inside})`);
    assert.ok(!inside.includes('customer'), 'the person outside the boundary stayed');
    // A line with both ends inside keeps its drawn route and slides with them.
    const both = Object.entries(before.edges).find(([, e]) => inside.includes(e.from) && inside.includes(e.to));
    assert.equal(after.edges[both[0]].d, both[1].d, 'route unchanged');
    assert.equal(after.edges[both[0]].t, after.nodes.shop, 'slid by the same amount');
    assert.deepEqual([...problems, ...c4.problems], []);
    await c4.page.close();
  });

  test(`${mode}: Fit and SVG export take in boxes moved outside the original drawing`, { skip }, async () => {
    const { page } = await open(url[mode]['order.lifecycle']);
    await page.click('[data-role=zoom-fit]');
    const vb0 = (await layout(page)).viewBox.split(' ').map(Number);
    await drag(page, page.locator('svg.vibex [data-node-id="delivered"]'), 300, 300);
    await page.click('[data-role=zoom-fit]');
    const vb1 = (await layout(page)).viewBox.split(' ').map(Number);
    assert.ok(vb1[2] > vb0[2] || vb1[3] > vb0[3], 'fit grew to include the moved box');
    const download = page.waitForEvent('download');
    await page.click('[data-role=export-svg]');
    const file = await (await download).path();
    const svg = fs.readFileSync(file, 'utf8');
    assert.match(svg, /data-node-id="delivered"[^>]*transform="translate\(/, 'export has the moved box');
    assert.ok(svg.includes(`viewBox="${vb1.join(' ')}"`), 'export framed to include it');
    await page.close();
  });

  test(`${mode}: dashboard keeps each panel's moves, zoom, selection and search while you move around`, { skip }, async () => {
    const { page, problems } = await open(url[mode].dashboard);
    const panelFor = async (title) => {
      const id = await page.locator('nav a[data-panel]', { hasText: title }).first().getAttribute('data-panel');
      await page.locator(`nav a[data-panel="${id}"]`).click();
      return page.locator(`.panel[data-panel="${id}"]`);
    };
    let erd = await panelFor('Orders domain');
    await erd.locator('[data-role=zoom-fit]').click();
    await drag(page, erd.locator('svg.vibex [data-node-id="order"]'), 120, 60);
    await erd.locator('[data-role=zoom-in]').click();
    const target = await erd.locator('svg.vibex [data-node-id="product"] rect.box').boundingBox();
    await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);
    const state = async (p) => ({ layout: await layout(p), details: await p.locator('[data-role=details]').innerText(), search: await p.locator('[data-role=search]').inputValue() });
    const erdState = await state(erd);

    let life = await panelFor('Order lifecycle');
    await life.locator('[data-role=zoom-fit]').click();
    await drag(page, life.locator('svg.vibex [data-node-id="paid"]'), 0, 120);
    await life.locator('[data-role=search]').fill('pay');
    const lifeState = await state(life);

    await page.locator('nav a[data-panel="overview"]').click();
    erd = await panelFor('Orders domain');
    assert.deepEqual(await state(erd), erdState, 'ERD panel exactly as left');
    life = await panelFor('Order lifecycle');
    assert.deepEqual(await state(life), lifeState, 'lifecycle panel exactly as left');

    await page.reload();
    erd = await panelFor('Orders domain');
    assert.equal((await layout(erd)).nodes.order, null, 'reload drew the original layout');
    assert.deepEqual(problems, []);
    await page.close();
  });
}
