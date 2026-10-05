// The Mermaid button, on a page and on every dashboard panel. Run: see linked.e2e.mjs.
// VIBEX_MERMAID=/path/to/mermaid.min.js also renders each export with real Mermaid.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderSpec } from '../../renderers/shared/render.mjs';
import { renderDashboard } from '../../renderers/shared/dashboard.mjs';
import { toMermaid } from '../../renderers/mermaid/to-mermaid.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

let chromium;
try { ({ chromium } = await import('playwright-core')); } catch { /* skipped below */ }
const skip = chromium ? false : 'playwright-core is not installed (npm i --no-save playwright-core)';
const mermaidJs = process.env.VIBEX_MERMAID;

const NAMES = ['orders.erd', 'shop.c4', 'order.lifecycle', 'shop.endpoints', 'shop.links'];
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vibex-mermaid-'));
const url = {};
for (const linked of [false, true]) {
  const dir = path.join(out, linked ? 'linked' : 'inline');
  fs.mkdirSync(dir, { recursive: true });
  const put = (name, { html, files }) => {
    fs.writeFileSync(path.join(dir, `${name}.html`), html);
    for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), c);
    url[`${linked ? 'linked' : 'inline'}:${name}`] = pathToFileURL(path.join(dir, `${name}.html`)).href;
  };
  for (const name of NAMES) put(name, renderSpec(json(`examples/${name}.json`), { linked, name, specId: name }));
  put('dashboard', renderDashboard(NAMES.map((f) => ({ file: f, spec: json(`examples/${f}.json`) })), { title: 'Shop', linked, name: 'dashboard' }));
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

async function grab(page, scope) {
  const download = page.waitForEvent('download');
  await scope.locator('[data-role=export-mermaid]').click();
  const d = await download;
  return { name: d.suggestedFilename(), text: fs.readFileSync(await d.path(), 'utf8') };
}

async function rendersInMermaid(text) {
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');
  await page.addScriptTag({ path: mermaidJs });
  const r = await page.evaluate(async (t) => {
    mermaid.initialize({ startOnLoad: false });
    try { await mermaid.render('g', t); return null; } catch (e) { return String(e.message || e); }
  }, text);
  await page.close();
  return r;
}

for (const mode of ['inline', 'linked']) {
  test(`${mode}: every page's Mermaid button downloads the spec as Mermaid`, { skip }, async () => {
    for (const name of NAMES) {
      const page = await browser.newPage({ acceptDownloads: true });
      await page.goto(url[`${mode}:${name}`]);
      const { name: file, text } = await grab(page, page);
      assert.equal(file, `${json(`examples/${name}.json`).meta.id || name}.mmd`);
      assert.equal(text, toMermaid(json(`examples/${name}.json`)), name);
      if (mermaidJs) assert.equal(await rendersInMermaid(text), null, `${name} renders in Mermaid`);
      await page.close();
    }
  });

  test(`${mode}: each dashboard panel exports its own diagram`, { skip }, async () => {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto(url[`${mode}:dashboard`]);
    for (const name of ['shop.links', 'order.lifecycle']) {
      const title = json(`examples/${name}.json`).meta.title;
      const id = await page.locator('nav a[data-panel]', { hasText: title }).first().getAttribute('data-panel');
      await page.locator(`nav a[data-panel="${id}"]`).click();
      const { text } = await grab(page, page.locator(`.panel[data-panel="${id}"]`));
      assert.equal(text, toMermaid(json(`examples/${name}.json`)), name);
    }
    await page.close();
  });
}
