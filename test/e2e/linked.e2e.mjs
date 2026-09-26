// A --linked page must behave exactly like the single-file page.
// Run: npm i --no-save playwright-core && npm run test:e2e  (uses Chrome; VIBEX_CHROME overrides)
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
const EXAMPLES = fs.readdirSync(path.join(root, 'examples')).filter((f) => /\.(erd|c4|endpoints|lifecycle)\.json$/.test(f));

let chromium;
try { ({ chromium } = await import('playwright-core')); } catch { /* skipped below */ }
const skip = chromium ? false : 'playwright-core is not installed (npm i --no-save playwright-core)';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vibex-e2e-'));
const MODES = ['inline', 'linked'];
let browser;

function write(mode, name, html, files) {
  const dir = path.join(out, mode);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.html`), html);
  for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), c);
  return pathToFileURL(path.join(dir, `${name}.html`)).href;
}

const AMP_TEXT = 'R&amp;D keeps &lt;b&gt; and &#39; literally';

const url = { inline: {}, linked: {} };
for (const mode of MODES) {
  const linked = mode === 'linked';
  for (const file of EXAMPLES) {
    const name = file.replace(/\.json$/, '');
    const { html, files } = renderSpec(json(`examples/${file}`), { linked, name });
    url[mode][name] = write(mode, name, html, files);
  }
  const items = fs.readdirSync(path.join(root, 'examples')).filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: f.replace(/\.json$/, ''), spec: json(`examples/${f}`) }));
  const dash = renderDashboard(items, { title: 'Shop', linked, name: 'dashboard' });
  url[mode].dashboard = write(mode, 'dashboard', dash.html, dash.files);
  const hostile = renderSpec(json('test/fixtures/hostile.erd.json'), { linked, name: 'hostile' });
  url[mode].hostile = write(mode, 'hostile', hostile.html, hostile.files);
  // Text that looks like an entity must reach the reader as typed: the spec
  // block is JSON, and decoding it as HTML would turn "&amp;" into "&".
  const amp = json('examples/orders.erd.json');
  amp.entities[0].description = AMP_TEXT;
  const ampPage = renderSpec(amp, { linked, name: 'amp' });
  url[mode].amp = write(mode, 'amp', ampPage.html, ampPage.files);
  const hdash = renderDashboard([{ file: 'hostile', spec: json('test/fixtures/hostile.erd.json') }, items.find((i) => i.file === 'orders.erd')], { title: 'D<!-- VIBEX:SPECS -->', linked, name: 'hostile-dash' });
  url[mode]['hostile-dash'] = write(mode, 'hostile-dash', hdash.html, hdash.files);
}

before(async () => {
  if (skip) return;
  browser = await chromium.launch(process.env.VIBEX_CHROME ? { executablePath: process.env.VIBEX_CHROME } : { channel: 'chrome' });
});
after(async () => {
  await browser?.close();
  fs.rmSync(out, { recursive: true, force: true });
});

async function open(href, { hash = '' } = {}) {
  const page = await browser.newPage({ acceptDownloads: true });
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`));
  page.on('dialog', (d) => { problems.push(`dialog: ${d.message()}`); d.dismiss(); });
  await page.goto(href + hash);
  await page.waitForLoadState('load');
  return { page, problems };
}

const leftovers = (page) => page.evaluate(() => {
  const found = [];
  const w = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT);
  for (let n = w.currentNode; n; n = w.nextNode()) {
    if (n.nodeType === 8) { if (/^ VIBEX:/.test(n.data)) found.push(`comment ${n.data}`); continue; }
    for (const a of n.attributes) if (a.value.includes('<!-- VIBEX:')) found.push(`attr ${n.tagName}.${a.name}`);
    if ((n.tagName === 'TITLE' || n.tagName === 'SCRIPT') && n.textContent.includes('<!-- VIBEX:')) found.push(`text ${n.tagName}`);
  }
  return found;
});

// Build timestamp and asset tags legitimately differ between modes.
const snapshot = (page) => page.evaluate(() => {
  const clone = document.documentElement.cloneNode(true);
  clone.querySelectorAll('script, style, link, meta[name="vibex:built"]').forEach((e) => e.remove());
  return clone.outerHTML.replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, 'TS').replace(/\s+/g, ' ');
});

// Real mouse click: the viewer selects on pointerup, not on click.
async function clickNode(scope, node) {
  await scope.locator('[data-role=zoom-fit]').click();
  const box = await node.boundingBox();
  await scope.page().mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function exercise(page) {
  const r = {};
  const v = page.locator('[data-role=viewer]').first();
  r.title = await page.title();
  r.type = await page.getAttribute('html', 'data-diagram-type');
  r.badge = await v.locator('.type-badge').textContent();
  r.nodes = await v.locator('svg.vibex [data-node-id]').count();
  r.stats = (await v.locator('[data-role=stats]').textContent()).trim();

  const ids = await v.locator('svg.vibex [data-node-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')));
  const first = ids[0];
  await clickNode(v, v.locator(`svg.vibex [data-node-id="${first}"]`).first());
  r.details = (await v.locator('[data-role=details]').innerText()).trim();
  r.selected = await v.locator('svg.vibex .selected, svg.vibex .is-selected, svg.vibex [aria-selected=true]').count();

  await page.keyboard.press('Escape');
  const term = first.slice(0, 3);
  await v.locator('[data-role=search]').fill(term);
  r.search = { term, matches: await v.locator('svg.vibex .match').count(), details: (await v.locator('[data-role=details]').innerText()).trim() };
  await v.locator('[data-role=search]').fill('');

  const transform = () => v.locator('svg.vibex').evaluate((s) => s.getAttribute('viewBox') + '|' + (s.style.transform || '') + '|' + (s.parentElement.style.transform || '') + '|' + (s.querySelector('g')?.getAttribute('transform') || ''));
  const t0 = await transform();
  await v.locator('[data-role=zoom-in]').click();
  r.zoomChanged = (await transform()) !== t0;
  await v.locator('[data-role=zoom-fit]').click();

  const theme0 = await page.getAttribute('html', 'data-theme');
  await v.locator('[data-role=theme]').click();
  r.themeFlipped = (await page.getAttribute('html', 'data-theme')) !== theme0
    && (await v.locator('svg.vibex').getAttribute('data-theme')) === (await page.getAttribute('html', 'data-theme'));

  const download = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await v.locator('[data-role=export-svg]').click();
  const d = await download;
  r.exportSvg = d ? d.suggestedFilename().endsWith('.svg') : false;
  return { r, first };
}

for (const file of EXAMPLES) {
  const name = file.replace(/\.json$/, '');
  test(`${name}: linked page loads from file:// and matches the single-file page`, { skip }, async () => {
    const seen = {};
    for (const mode of MODES) {
      const { page, problems } = await open(url[mode][name]);
      assert.deepEqual(problems, [], `${mode}: nothing failed while loading`);
      assert.deepEqual(await leftovers(page), [], `${mode}: every slot filled`);
      seen[mode] = { dom: await snapshot(page), ...(await exercise(page)) };
      assert.deepEqual(problems, [], `${mode}: nothing failed while interacting`);
      await page.close();
    }
    const spec = json(`examples/${file}`);
    const { r } = seen.linked;
    assert.equal(r.title, spec.meta.title);
    assert.equal(r.type, spec.diagram_type);
    assert.ok(r.nodes > 0, 'diagram drawn');
    assert.ok(r.stats.length > 0, 'viewer computed stats');
    assert.ok(r.details.length > 0 && !/Click a node/.test(r.details), 'clicking a node shows its details');
    assert.ok(r.search.matches > 0, `search for "${r.search.term}" finds nodes`);
    assert.ok(r.zoomChanged, 'zoom in moves the view');
    assert.ok(r.themeFlipped, 'theme toggle reaches the page and the svg');
    assert.ok(r.exportSvg, 'SVG export downloads a file');
    assert.equal(seen.linked.dom, seen.inline.dom, 'identical DOM after load');
    assert.deepEqual(seen.linked.r, seen.inline.r, 'every interaction shows the same thing');
  });

  test(`${name}: #node= deep link selects the node in both modes`, { skip }, async () => {
    const spec = json(`examples/${file}`);
    const coll = ['entities', 'elements', 'endpoints', 'states'].find((c) => spec[c]?.length);
    const id = spec[coll][0].id;
    const details = {};
    for (const mode of MODES) {
      const { page, problems } = await open(url[mode][name], { hash: `#node=${encodeURIComponent(id)}` });
      details[mode] = (await page.locator('[data-role=details]').innerText()).trim();
      assert.deepEqual(problems, []);
      await page.close();
    }
    assert.ok(!/Click a node/.test(details.linked), 'deep link opened the node');
    assert.equal(details.linked, details.inline);
  });
}

test('dashboard: linked build navigates every panel exactly like the single-file build', { skip }, async () => {
  const seen = {};
  for (const mode of MODES) {
    const { page, problems } = await open(url[mode].dashboard);
    assert.deepEqual(await leftovers(page), [], `${mode}: every slot filled`);
    const s = { dom: await snapshot(page), title: await page.title(), panels: [] };
    const links = await page.locator('nav a[data-panel]').evaluateAll((as) => as.map((a) => a.getAttribute('data-panel')));
    assert.ok(links.length > 3, 'nav lists the panels');
    for (const id of links) {
      await page.locator(`nav a[data-panel="${id}"]`).click();
      const panel = page.locator(`.panel[data-panel="${id}"]`);
      assert.ok(await panel.evaluate((p) => p.classList.contains('active')), `${mode}: panel ${id} opens`);
      const entry = { id, hash: new URL(page.url()).hash, text: (await panel.innerText()).slice(0, 400) };
      const node = panel.locator('svg.vibex [data-node-id]').first();
      if (await node.count()) {
        await clickNode(panel, node);
        entry.details = (await panel.locator('[data-role=details]').innerText()).trim();
        assert.ok(!/Click a node/.test(entry.details), `${mode}: panel ${id} viewer responds to a click`);
      }
      s.panels.push(entry);
    }
    // An overview cross-link jumps to another panel with a node selected.
    await page.locator('nav a[data-panel="overview"]').click();
    const xlink = page.locator('.overview [data-goto-node]').first();
    if (await xlink.count()) {
      await xlink.click();
      s.crossLink = new URL(page.url()).hash;
      assert.match(s.crossLink, /#d=\d+&node=/, `${mode}: cross-link lands on a node`);
    }
    await page.locator('[data-role=theme-global]').click();
    s.theme = await page.getAttribute('html', 'data-theme');
    assert.deepEqual(problems, [], `${mode}: nothing failed`);
    seen[mode] = s;
    await page.close();
  }
  assert.equal(seen.linked.dom, seen.inline.dom, 'identical DOM after load');
  const { dom: _a, ...linked } = seen.linked;
  const { dom: _b, ...inline } = seen.inline;
  assert.deepEqual(linked, inline, 'every panel shows the same thing');
});

test('dashboard: #d= deep link opens the panel in linked mode', { skip }, async () => {
  const { page, problems } = await open(url.linked.dashboard, { hash: '#d=1' });
  assert.ok(await page.locator('.panel[data-panel="1"]').evaluate((p) => p.classList.contains('active')));
  assert.deepEqual(problems, []);
  await page.close();
});

for (const name of ['hostile', 'hostile-dash']) {
  test(`${name}: markers and script payloads in the spec stay text in linked mode`, { skip }, async () => {
    const seen = {};
    for (const mode of MODES) {
      const { page, problems } = await open(url[mode][name]);
      assert.deepEqual(problems, [], `${mode}: no script ran, no dialog, no error`);
      const title = await page.title();
      assert.ok(!/^XSS\d$/.test(title), `${mode}: no payload rewrote the title (${title})`);
      assert.equal(await page.locator('img[src=x]').count(), 0, `${mode}: no injected <img>`);
      assert.equal(await page.locator('body script:not([src]):not([type="application/json"])').evaluateAll((s) => s.filter((x) => /XSS/.test(x.textContent)).length), 0, `${mode}: no injected <script>`);
      seen[mode] = { title, dom: await snapshot(page) };
      await page.close();
    }
    assert.ok(seen.linked.title.includes('<!-- VIBEX:'), 'marker text shows literally in the title');
    assert.equal(seen.linked.title, seen.inline.title);
    assert.equal(seen.linked.dom, seen.inline.dom);
  });
}

test('entity-like text in a spec is shown as typed in linked mode', { skip }, async () => {
  const id = json('examples/orders.erd.json').entities[0].id;
  const details = {};
  for (const mode of MODES) {
    const { page, problems } = await open(url[mode].amp, { hash: `#node=${encodeURIComponent(id)}` });
    details[mode] = await page.locator('[data-role=details]').innerText();
    assert.deepEqual(problems, []);
    await page.close();
  }
  assert.ok(details.linked.includes(AMP_TEXT), 'shown literally');
  assert.equal(details.linked, details.inline);
});

test('linked page opened without its data file fails visibly, not silently wrong', { skip }, async () => {
  const dir = path.join(out, 'orphan');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(fileURLToPath(url.linked['orders.erd']), path.join(dir, 'orders.erd.html'));
  const { page, problems } = await open(pathToFileURL(path.join(dir, 'orders.erd.html')).href);
  assert.ok(problems.length > 0, 'the missing files are reported');
  assert.equal(await page.locator('svg.vibex').count(), 0, 'no stale diagram shown');
  await page.close();
});
