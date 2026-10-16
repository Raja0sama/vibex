import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findWorkspace, slugOf } from '../renderers/shared/workspace.mjs';
import { hostFiles, isOurs } from '../renderers/shared/host.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'bin/vibex.mjs'), ...args], { cwd: root, encoding: 'utf8' });
const example = (name) => path.join(root, 'examples', name);

// Two repos with specs in different places, a shared folder that is not a
// repo, a folder with no specs, and a vendored copy that must be ignored.
function workspace() {
  const w = fs.mkdtempSync(path.join(os.tmpdir(), 'vibex-ws-'));
  const put = (dir, ...files) => { fs.mkdirSync(path.join(w, dir), { recursive: true }); for (const f of files) fs.copyFileSync(example(f), path.join(w, dir, f)); };
  put('storefront/docs/arch', 'shop.c4.json', 'checkout.sequence.json');
  put('order-service/architecture', 'orders.erd.json', 'order.lifecycle.json');
  put('order-service/node_modules/pkg', 'shop.c4.json');
  put('shared-docs', 'shop.links.json');
  fs.mkdirSync(path.join(w, 'no-specs/src'), { recursive: true });
  fs.mkdirSync(path.join(w, 'storefront/.git'));
  return w;
}

test('workspace: one group per top-level folder with specs; vendored and spec-less folders are left out', () => {
  const w = workspace();
  const { groups } = findWorkspace(w);
  assert.deepEqual(groups.map((g) => g.name), ['order-service', 'shared-docs', 'storefront']);
  const byName = Object.fromEntries(groups.map((g) => [g.name, g]));
  assert.equal(byName['order-service'].files.length, 2, 'node_modules is not read');
  assert.equal(byName.storefront.isRepo, true);
  assert.equal(byName['shared-docs'].isRepo, false);
  fs.copyFileSync(example('shop.c4.json'), path.join(w, 'top.c4.json'));
  assert.equal(findWorkspace(w).groups[0].name, 'shared', 'specs in the workspace root form their own group');
  assert.equal(slugOf('My Repo!'), 'my-repo');
});

test('workspace: builds a stamped landing page and one dashboard per repo, and cleans up a repo that went away', () => {
  const w = workspace();
  const site = path.join(w, 'vibex-site');
  const r = cli('workspace', w, '--title', 'Shop', '--json');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.repos.map((x) => [x.name, x.diagrams]), [['order-service', 2], ['shared-docs', 1], ['storefront', 2]]);
  const index = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
  for (const slug of ['order-service', 'shared-docs', 'storefront']) {
    assert.ok(index.includes(`href="./${slug}/"`), slug);
    assert.ok(fs.existsSync(path.join(site, slug, 'index.html')), `${slug} dashboard`);
  }
  assert.equal(cli('outdated', site).status, 0, 'the landing page carries the build stamp too');

  fs.rmSync(path.join(w, 'shared-docs'), { recursive: true });
  assert.equal(cli('workspace', w).status, 0);
  assert.ok(!fs.existsSync(path.join(site, 'shared-docs')), 'a repo with no specs left loses its folder');
  assert.ok(fs.existsSync(path.join(site, 'storefront', 'index.html')));
});

test('workspace: will not write into a folder it did not build', () => {
  const w = workspace();
  const foreign = path.join(w, 'mine');
  fs.mkdirSync(foreign);
  fs.writeFileSync(path.join(foreign, 'notes.txt'), 'keep me');
  const r = cli('workspace', w, '-o', foreign);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /was not built by "vibex workspace"/);
  assert.equal(fs.readFileSync(path.join(foreign, 'notes.txt'), 'utf8'), 'keep me');
  assert.match(cli('workspace', path.join(w, 'no-specs')).stderr, /No vibeX specs/);
});

test('host: writes nginx + Docker files, keeps a hand-written one, and refuses a folder with no pages', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibex-host-'));
  assert.match(cli('host', dir).stderr, /No \.html files/);
  fs.writeFileSync(path.join(dir, 'dashboard.html'), '<!doctype html>');
  const first = cli('host', dir, '--json');
  assert.equal(first.status, 0, first.stderr);
  for (const f of Object.keys(hostFiles())) assert.ok(isOurs(fs.readFileSync(path.join(dir, f), 'utf8')), f);
  assert.equal(JSON.parse(first.stdout).landing, 'dashboard.html');

  fs.writeFileSync(path.join(dir, 'Dockerfile'), 'FROM my-own-image\n');
  const kept = cli('host', dir);
  assert.equal(kept.status, 1);
  assert.match(kept.stderr, /kept Dockerfile/);
  assert.equal(fs.readFileSync(path.join(dir, 'Dockerfile'), 'utf8'), 'FROM my-own-image\n');
  assert.equal(cli('host', dir, '--force').status, 0);
  assert.ok(isOurs(fs.readFileSync(path.join(dir, 'Dockerfile'), 'utf8')));
});

test('host: the login is on unless explicitly turned off, and health checks skip it', () => {
  const files = hostFiles();
  const auth = files['.vibex-host/40-vibex-auth.sh'];
  assert.match(auth, /VIBEX_PUBLIC:-}" = "1"/);
  assert.match(auth, /-z "\$\{VIBEX_USER:-}" \] \|\| \[ -z "\$\{VIBEX_PASSWORD:-}" \]; then[\s\S]*?exit 1/);
  assert.doesNotMatch(auth, /mkpasswd[^|\n]*\$VIBEX_PASSWORD/, 'the password goes in on stdin, not the command line');
  const conf = files['.vibex-host/default.conf.template'];
  assert.match(conf, /location = \/healthz \{ auth_basic off;/);
  assert.match(conf, /location ~ \/\\\. \{ deny all; \}/);
  assert.match(files.Dockerfile, /rm -rf \/usr\/share\/nginx\/html\/\.vibex-host .*Dockerfile .*docker-compose\.yml/);
});
