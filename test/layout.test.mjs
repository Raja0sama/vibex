import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateSpec } from '../renderers/shared/validate.mjs';
import { RENDERERS } from '../renderers/shared/render.mjs';

const renderSpec = (spec) => RENDERERS[spec.diagram_type](spec);
import { parseLayout, checkLayoutAgainst, applyLayout, boxIds, spliceLayout } from '../renderers/shared/positions.mjs';
import { parseIntake, triage, PLAYBOOK } from '../renderers/shared/triage.mjs';
import { routeHits } from '../renderers/shared/layout.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Examples may carry pins of their own; these tests start from the generated layout.
const json = (p) => { const spec = JSON.parse(fs.readFileSync(path.join(root, p), 'utf8')); if (spec.layout) delete spec.layout.positions; return spec; };
const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'bin/vibex.mjs'), ...args], { cwd: root, encoding: 'utf8' });
const atOf = (svg, id) => {
  const m = new RegExp(`data-node-id="${id}"[^>]*data-at="([^"]+)"`).exec(svg);
  return m && m[1].split(' ').map(Number);
};

test('layout: a pinned box renders at its position, and stale or malformed pins are reported', () => {
  for (const [file, id] of [['orders.erd', 'order'], ['shop.c4', 'order_api'], ['order.lifecycle', 'paid'], ['shop.endpoints', 'orders']]) {
    const spec = json(`examples/${file}.json`);
    applyLayout(spec, { [id]: [3000, 2000] });
    assert.deepEqual(validateSpec(spec).errors, [], file);
    const { svg } = renderSpec(spec);
    assert.deepEqual(atOf(svg, id), [3000, 2000], `${file}: ${id} pinned`);
  }
  const spec = json('examples/shop.c4.json');
  spec.layout = { positions: { gone: [1, 2], order_api: [1, 'x'] } };
  const report = validateSpec(spec);
  assert.ok(report.errors.some((e) => /order_api must be \[x, y\]/.test(e.message)));
  assert.ok(report.warnings.some((w) => w.code === 'stale-position'));
});

test('layout: a pin left of the canvas shifts everything back on, keeping the arrangement', () => {
  const spec = json('examples/order.lifecycle.json');
  const before = renderSpec(spec).svg;
  applyLayout(spec, { paid: [-500, -400] });
  const { svg } = renderSpec(spec);
  const paid = atOf(svg, 'paid'); const draft = atOf(svg, 'draft');
  assert.ok(paid[0] >= 0 && paid[1] >= 0, 'on the canvas');
  assert.deepEqual([draft[0] - paid[0], draft[1] - paid[1]].map(Math.round), [atOf(before, 'draft')[0] + 500, atOf(before, 'draft')[1] + 400].map(Math.round), 'others keep their place relative to the pin');
});

test('layout: a line that would cross a pinned box goes around it', () => {
  const spec = json('examples/order.lifecycle.json');
  applyLayout(spec, { paid: [290, 100] });
  const { svg } = renderSpec(spec);
  const box = (id) => { const [x, y] = atOf(svg, id); const m = new RegExp(`data-node-id="${id}"[\\s\\S]*?<rect[^>]*width="([\\d.]+)" height="([\\d.]+)"`).exec(svg); return { x, y, w: +m[1], h: +m[2] }; };
  const m = /data-edge-from="draft" data-edge-to="placed"[\s\S]*?d="([^"]+)"/.exec(svg);
  const n = m[1].match(/-?\d*\.?\d+/g).map(Number);
  const points = []; for (let i = 0; i + 1 < n.length; i += 2) points.push([n[i], n[i + 1]]);
  assert.deepEqual(routeHits(points, [box('paid')]), [], 'draft → placed does not cut through paid');
});

test('layout: parseLayout reads the JSON itself or a fenced block in an issue body', () => {
  const data = { vibex_layout: 1, spec: 'shop.c4', positions: { bff: [1, 2] } };
  assert.deepEqual(parseLayout(JSON.stringify(data)), data);
  assert.deepEqual(parseLayout(`Please save\n\n\`\`\`vibex\nintent: layout\n\`\`\`\n\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\``), data);
  assert.equal(parseLayout('no layout here'), null);
  assert.deepEqual([...boxIds(json('examples/shop.endpoints.json'))].includes('orders'), true, 'endpoint cards pin by group id');
});

test('layout: checkLayoutAgainst keeps known boxes and names the rest', () => {
  const spec = json('examples/order.lifecycle.json');
  const r = checkLayoutAgainst(spec, { spec: 'order.lifecycle', positions: { paid: [10.4, 20.6], ghost: [1, 1], placed: [1] } });
  assert.deepEqual(r, { good: { paid: [10, 21] }, unknown: ['ghost'], invalid: ['placed'], wrongSpec: false });
  assert.equal(checkLayoutAgainst(spec, { spec: 'other', positions: {} }).wrongSpec, true);
});

test('layout CLI: merges, replaces, clears, and refuses a layout for another spec', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibex-layout-'));
  const file = path.join(dir, 'order.lifecycle.json');
  fs.writeFileSync(file, JSON.stringify(json('examples/order.lifecycle.json'), null, 2));
  const put = (name, data) => { const p = path.join(dir, name); fs.writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data)); return p; };
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8')).layout?.positions;

  let r = cli('layout', file, put('a.json', { positions: { paid: [1, 2] } }));
  assert.equal(r.status, 0, r.stderr);
  r = cli('layout', file, put('b.md', 'see\n```json\n{"positions":{"placed":[3,4],"nope":[0,0]}}\n```'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /skipped 1 id\(s\) not in this diagram: nope/);
  assert.deepEqual(read(), { paid: [1, 2], placed: [3, 4] }, 'merged');
  assert.equal(cli('layout', file, put('c.json', { positions: { draft: [5, 6] } }), '--replace').status, 0);
  assert.deepEqual(read(), { draft: [5, 6] }, 'replaced');
  r = cli('layout', file, put('d.json', { spec: 'shop.c4', positions: { draft: [7, 8] } }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /saved from "shop.c4"/);
  assert.equal(cli('layout', file, '--clear').status, 0);
  assert.equal(read(), undefined, 'cleared');
  assert.equal(cli('layout', file, put('e.json', 'nothing')).status, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('triage: a layout issue is acted on only when its spec and boxes exist', () => {
  const specs = new Map([['order.lifecycle', json('examples/order.lifecycle.json')]]);
  const specIds = new Set(specs.keys());
  const body = (spec, positions) => `Please save this layout\n\n---\n\n\`\`\`vibex\nintent: layout\nspec: ${spec}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify({ vibex_layout: 1, spec, positions })}\n\`\`\``;
  const run = (text) => triage(parseIntake(text), { specIds, specs, body: text });

  const ok = run(body('order.lifecycle', { paid: [1, 2], ghost: [0, 0] }));
  assert.equal(ok.action, 'act');
  assert.deepEqual(ok.target, { kind: 'layout', spec: 'order.lifecycle', boxes: 1, skipped: ['ghost'] });
  assert.ok(PLAYBOOK.layout.includes('vibex.mjs layout'));
  assert.equal(run(body('nope', { paid: [1, 2] })).reason, 'unknown spec');
  assert.equal(run(body('order.lifecycle', { ghost: [1, 2] })).reason, 'no known boxes');
  assert.equal(run('```vibex\nintent: layout\nspec: order.lifecycle\n```').reason, 'no layout');
});

test('layout: writing positions touches only the layout block, and clearing restores the file byte for byte', () => {
  const roundTrip = (text, positions) => {
    const spec = JSON.parse(text);
    applyLayout(spec, positions);
    const pinned = spliceLayout(text, spec);
    assert.deepEqual(JSON.parse(pinned), spec);
    applyLayout(spec, {}, { replace: true });
    return { pinned, cleared: spliceLayout(pinned, spec) };
  };
  const original = fs.readFileSync(path.join(root, 'examples/shop.c4.json'), 'utf8');
  const { pinned, cleared } = roundTrip(original, { paid: [1, 2] });
  assert.ok(pinned.startsWith(original.slice(0, original.lastIndexOf(']'))), 'everything before layout untouched');
  assert.equal(cleared, original);

  for (const text of [
    '{\n  "layout": { "direction": "lr" },\n  "a": 1\n}\n',
    '{\n  "a": 1,\n  "layout": { "direction": "lr" },\n  "b": "x, }"\n}\n',
    '{\n  "a": 1,\n  "layout": { "direction": "lr" }\n}\n',
  ]) {
    const { pinned: p, cleared: c } = roundTrip(text, { k: [3, 4] });
    assert.match(p, /"direction": "lr"/);
    assert.equal(c, text, 'only layout.positions came and went');
  }
  const first = '{\n  "layout": { "positions": { "k": [1, 2] } },\n  "a": 1\n}\n';
  const spec = JSON.parse(first);
  applyLayout(spec, {}, { replace: true });
  assert.deepEqual(JSON.parse(spliceLayout(first, spec)), { a: 1 }, 'removing a first-key layout leaves valid JSON');
});
