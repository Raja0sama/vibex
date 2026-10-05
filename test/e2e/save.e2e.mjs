// Save layout: drag, save, apply with `vibex layout`, re-render, and the box is
// where it was dropped. Run: see linked.e2e.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cli = path.join(root, 'bin/vibex.mjs');

let chromium;
try { ({ chromium } = await import('playwright-core')); } catch { /* skipped below */ }
const skip = chromium ? false : 'playwright-core is not installed (npm i --no-save playwright-core)';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vibex-save-'));
let browser;
before(async () => {
  if (skip) return;
  browser = await chromium.launch(process.env.VIBEX_CHROME ? { executablePath: process.env.VIBEX_CHROME } : { channel: 'chrome' });
});
after(async () => {
  await browser?.close();
  fs.rmSync(out, { recursive: true, force: true });
});

function render(name) {
  const file = path.join(out, `${name}.json`);
  if (!fs.existsSync(file)) fs.copyFileSync(path.join(root, 'examples', `${name}.json`), file);
  execFileSync('node', [cli, 'render', file, path.join(out, `${name}.html`)], { stdio: 'pipe' });
  return pathToFileURL(path.join(out, `${name}.html`)).href;
}

async function drag(page, locator, dx, dy) {
  const box = await locator.boundingBox();
  const x = box.x + Math.min(30, box.width / 2); const y = box.y + Math.min(12, box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}

const at = (page, id) => page.locator(`svg.vibex [data-node-id="${id}"]`).evaluate((el) => {
  const p = el.getAttribute('data-at').split(' ').map(Number);
  const m = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(el.getAttribute('transform') || '');
  return [p[0] + (m ? +m[1] : 0), p[1] + (m ? +m[2] : 0)];
});

const CASES = [
  ['orders.erd', 'order', true],
  ['shop.c4', 'order_api', false],
  ['order.lifecycle', 'paid', true],
  ['shop.endpoints', 'orders', true],
];

for (const [name, id, hasRepo] of CASES) {
  test(`${name}: a saved layout, applied with vibex layout, re-renders the box where it was dropped`, { skip }, async () => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await context.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    await page.goto(render(name));
    await page.click('[data-role=zoom-fit]');

    assert.ok(await page.locator('[data-role=save-layout]').isHidden(), 'nothing to save yet');
    await drag(page, page.locator(`svg.vibex [data-node-id="${id}"]`), 140, 120);
    const dropped = await at(page, id);
    await page.click('[data-role=save-layout]');

    const saved = JSON.parse(await page.locator('.save-json').innerText());
    assert.equal(saved.spec, name, 'names the spec it came from');
    assert.deepEqual(saved.positions[id], dropped.map(Math.round));
    assert.equal(await page.locator('.save-issue').count(), hasRepo ? 1 : 0, 'issue link only with meta.repository');
    if (hasRepo) {
      const href = await page.locator('.save-issue').getAttribute('href');
      const body = new URL(href).searchParams.get('body');
      assert.match(body, /intent: layout/);
      assert.ok(body.includes(JSON.stringify(saved)), 'issue carries the JSON');
    }

    await page.click('[data-save=json]');
    assert.deepEqual(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())), saved, 'Copy JSON copies the JSON');
    await page.click('[data-save=prompt]');
    const prompt = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(prompt, new RegExp(`vibex layout`));
    assert.ok(prompt.includes(`${name}.json`), 'prompt names the spec file');
    // The prompt carries everything: applying the JSON inside it is the whole job.
    const layoutFile = path.join(out, `${name}.prompt.md`);
    fs.writeFileSync(layoutFile, prompt);
    execFileSync('node', [cli, 'layout', path.join(out, `${name}.json`), layoutFile], { stdio: 'pipe' });

    await page.goto(render(name));
    assert.deepEqual(await at(page, id), dropped.map(Math.round), 'the re-rendered box sits where it was dropped');
    assert.ok(await page.locator('[data-role=save-layout]').isHidden(), 'fresh page, nothing unsaved');
    assert.deepEqual(problems, []);
    await context.close();
  });
}
