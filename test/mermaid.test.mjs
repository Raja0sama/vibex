import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { toMermaid } from '../renderers/mermaid/to-mermaid.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'bin/vibex.mjs'), ...args], { cwd: root, encoding: 'utf8' });

test('mermaid: every diagram type has a Mermaid form, headed by its title', () => {
  const kinds = { 'orders.erd': 'erDiagram', 'shop.c4': 'flowchart LR', 'order.lifecycle': 'stateDiagram-v2', 'shop.endpoints': 'flowchart LR', 'shop.links': 'flowchart LR' };
  for (const [file, kind] of Object.entries(kinds)) {
    const spec = json(`examples/${file}.json`);
    const text = toMermaid(spec);
    assert.ok(text.startsWith(`---\ntitle: ${JSON.stringify(spec.meta.title)}\n---\n`), file);
    assert.ok(text.split('\n').includes(kind), `${file} is a ${kind}`);
  }
  assert.equal(toMermaid({ diagram_type: 'docs' }), null);
});

test('mermaid: ERD keeps columns, keys and cardinality', () => {
  const text = toMermaid(json('examples/orders.erd.json'));
  assert.match(text, /n_user\["users"\] \{\n {4}uuid id PK\n/);
  assert.match(text, /text password_hash "nullable; null for SSO-only accounts"/);
  assert.match(text, /n_address \}o--\|\| n_user : "belongs to"/);
  assert.match(text, /n_order_status \{\n {4}enum pending/);
});

test('mermaid: C4 nests boundaries, shapes kinds, and dashes async arrows', () => {
  const text = toMermaid(json('examples/shop.c4.json'));
  assert.match(text, /subgraph n_shop\["Shop \(system\)"\]\n(.*\n)*? {4}subgraph n_backend/);
  assert.match(text, /n_db\[\("<b>Shop DB<\/b>/);
  assert.match(text, /n_customer\(\["<b>Customer<\/b>/);
  assert.match(text, /n_order_api -\.->\|"Publishes \[SQS\]"\| n_events/);
  assert.match(text, /class n_stripe external/);
});

test('mermaid: lifecycle starts and ends, and colours failure paths', () => {
  const text = toMermaid(json('examples/order.lifecycle.json'));
  assert.match(text, /\[\*\] --> n_draft/);
  assert.match(text, /n_delivered --> \[\*\]/);
  assert.match(text, /n_shipped --> n_delivered : carrier confirms \/ close the order/);
  assert.match(text, /class n_payment_failed failure/);
});

test('mermaid: hostile ids and text cannot break out of a label or hit a keyword', () => {
  const spec = {
    schema_version: 1, diagram_type: 'c4', meta: { title: 'a "quoted" title' },
    elements: [
      { id: 'end', kind: 'container', label: 'Ends "here" <script>' },
      { id: 'a-b', kind: 'system', label: 'x|y; #z' },
    ],
    relationships: [{ from: 'end', to: 'a-b', label: 'say "hi" | bye' }],
  };
  const text = toMermaid(spec);
  assert.ok(!/^\s*end\[/m.test(text), 'the keyword "end" is never a bare id');
  assert.match(text, /n_end\["<b>Ends #quot;here#quot; #lt;script#gt;<\/b>/);
  assert.match(text, /n_end -->\|"say #quot;hi#quot; \| bye"\| n_a_b/);
  assert.match(text, /title: "a \\"quoted\\" title"/);
});

test('mermaid CLI: prints or writes the text, and render leaves a .mmd beside the page', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibex-mmd-'));
  const r = cli('mermaid', 'examples/order.lifecycle.json');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, toMermaid(json('examples/order.lifecycle.json')));
  assert.equal(cli('mermaid', 'examples/shop.c4.json', path.join(dir, 'c4.mmd')).status, 0);
  assert.ok(fs.readFileSync(path.join(dir, 'c4.mmd'), 'utf8').includes('flowchart LR'));
  assert.equal(cli('render', 'examples/orders.erd.json', path.join(dir, 'erd.html')).status, 0);
  assert.equal(fs.readFileSync(path.join(dir, 'erd.mmd'), 'utf8'), toMermaid(json('examples/orders.erd.json')));
  fs.rmSync(dir, { recursive: true, force: true });
});
