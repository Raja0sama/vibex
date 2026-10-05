import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('install: plugin, package and SKILL.md agree on the version', () => {
  const version = JSON.parse(read('package.json')).version;
  assert.equal(JSON.parse(read('.claude-plugin/plugin.json')).version, version, 'Claude Code pins users to plugin.json');
  assert.match(read('SKILL.md'), new RegExp(`\\n  version: "${version.replace(/\./g, '\\.')}"\\n`));
});

test('install: the marketplace serves this repo as the vibex plugin', () => {
  const market = JSON.parse(read('.claude-plugin/marketplace.json'));
  assert.equal(market.name, 'vibex');
  assert.deepEqual(market.plugins.map((p) => [p.name, p.source]), [['vibex', './']]);
});

test('install: SKILL.md frontmatter fits every agent', () => {
  const fm = /^---\n([\s\S]*?)\n---/.exec(read('SKILL.md'))[1];
  assert.match(fm, /^name: vibex$/m);
  const description = /^description: '(.*)'$/m.exec(fm)?.[1];
  assert.ok(description, 'description is one single-quoted line');
  assert.ok(description.length <= 1024, `description is ${description.length} chars; the Agent Skills limit is 1024`);
});
