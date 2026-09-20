import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFingerprint, readStamp, stampHtml, packageVersion, outputFiles } from '../renderers/shared/stamp.mjs';
import { renderSpec } from '../renderers/shared/render.mjs';
import { renderDashboard, loadDashboardTemplate } from '../renderers/shared/dashboard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

// A throwaway copy of everything the fingerprint reads, so a test can change an
// asset without touching the working tree.
function copyPackage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibex-stamp-'));
  for (const sub of ['renderers', 'assets']) fs.cpSync(path.join(root, sub), path.join(dir, sub), { recursive: true });
  fs.copyFileSync(path.join(root, 'package.json'), path.join(dir, 'package.json'));
  return dir;
}

test('stamp: a generated file records the version and a build fingerprint', () => {
  const stamp = readStamp(stampHtml({ root }));
  assert.equal(stamp.version, packageVersion(root));
  assert.equal(stamp.build, buildFingerprint(root));
  assert.ok(stamp.stamped);
  assert.ok(!Number.isNaN(Date.parse(stamp.built)), 'built is an ISO date');
});

test('stamp: an unstamped file reports itself as unstamped rather than throwing', () => {
  const stamp = readStamp('<!doctype html><html><head><title>old</title></head><body></body></html>');
  assert.equal(stamp.stamped, false);
  assert.equal(stamp.version, null);
  assert.equal(stamp.build, null);
  assert.equal(readStamp(undefined).stamped, false);
});

test('stamp: the fingerprint covers the inlined assets, not just the version', () => {
  const a = copyPackage();
  const b = copyPackage();
  assert.equal(buildFingerprint(a), buildFingerprint(b), 'two identical copies agree');

  // A fix that only touches the stylesheet still changes what the output does.
  fs.appendFileSync(path.join(b, 'assets/viewer.css'), '\n.probe{color:red}\n');
  assert.notEqual(buildFingerprint(a), buildFingerprint(b), 'a css-only change is a reason to regenerate');

  // ...and so does a renderer change, with the version untouched either way.
  const c = copyPackage();
  fs.appendFileSync(path.join(c, 'renderers/shared/utils.mjs'), '\n// probe\n');
  assert.notEqual(buildFingerprint(a), buildFingerprint(c), 'a renderer change is too');
  assert.equal(packageVersion(a), packageVersion(c), 'neither moved the version');

  for (const d of [a, b, c]) fs.rmSync(d, { recursive: true, force: true });
});

test('stamp: the fingerprint does not depend on where the package is installed', () => {
  const a = copyPackage();
  const b = path.join(path.dirname(a), path.basename(a) + '-moved');
  fs.renameSync(a, b);
  const files = outputFiles(b);
  assert.ok(files.length > 10, 'it hashes the renderers and the assets');
  assert.ok(files.every((f) => f.startsWith(b)), 'and only those');
  fs.rmSync(b, { recursive: true, force: true });
});

test('stamp: every shell it ships stamps what it produced', () => {
  const single = renderSpec(json('examples/orders.erd.json')).html;
  assert.equal(readStamp(single).build, buildFingerprint(root), 'single page');

  const dash = renderDashboard([{ file: 'orders', spec: json('examples/orders.erd.json') }], { title: 'D' }).html;
  assert.equal(readStamp(dash).build, buildFingerprint(root), 'dashboard');

  // No raw slot survives either shell.
  assert.ok(!/<!-- VIBEX:STAMP -->/.test(single) && !/<!-- VIBEX:STAMP -->/.test(dash));
});

test('stamp: a shell without the slot fails loudly rather than shipping unstamped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibex-shell-'));
  const broken = path.join(dir, 'dashboard.html');
  fs.writeFileSync(broken, fs.readFileSync(path.join(root, 'assets/dashboard.html'), 'utf8').replace('<!-- VIBEX:STAMP -->', ''));
  assert.throws(() => loadDashboardTemplate(broken), /VIBEX:STAMP/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// The exit code is the contract CI gates on, so it is worth exercising the real
// command rather than only the functions behind it.
test('outdated: exits 0 on a fresh render and 1 once the renderer moves', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibex-out-'));
  const cli = path.join(root, 'bin/vibex.mjs');
  const run = (args) => {
    const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    return { code: r.status, out: r.stdout };
  };

  assert.equal(run(['render', path.join(root, 'examples/orders.erd.json'), path.join(dir, 'a.html')]).code, 0);

  const fresh = run(['outdated', dir]);
  assert.equal(fresh.code, 0, 'a file this build just wrote is current');
  assert.match(fresh.out, /current/);

  // Rewrite the stamp as if an older build had produced it.
  const file = path.join(dir, 'a.html');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/<meta name="vibex:build" content="[^"]*">/, '<meta name="vibex:build" content="0000000000000000">'));
  const stale = run(['outdated', dir]);
  assert.equal(stale.code, 1, 'a stale file fails the gate');
  assert.match(stale.out, /stale/);

  const report = JSON.parse(run(['outdated', dir, '--json']).out);
  assert.equal(report.outdated, 1);
  assert.equal(report.files[0].state, 'stale');

  fs.rmSync(dir, { recursive: true, force: true });
});
