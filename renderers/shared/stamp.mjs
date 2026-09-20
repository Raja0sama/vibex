// What produced this file.
//
// Two audiences. `generator` is for a person reading source: "vibex 0.3.0".
// `vibex:build` is for a machine: a fingerprint over everything that decides
// what a generated file contains — every renderer and every inlined asset.
//
// The fingerprint covers assets on purpose. A fix that only touches viewer.css
// changes what the output does without moving the version, and an artifact that
// cannot report that is indistinguishable from a broken feature.
//
// The spec is deliberately not in it. A generated file already carries its own
// spec, so "has the data changed" is a different question with a different
// answer, and mixing them would make one reason to regenerate look like another.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { esc } from './utils.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PKG_ROOT = path.resolve(here, '../..');

export function packageVersion(root = PKG_ROOT) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '0.0.0'; }
  catch { return '0.0.0'; }
}

// Sorted so the fingerprint does not depend on directory order, and relative so
// it does not depend on where the package is installed.
export function outputFiles(root = PKG_ROOT) {
  const found = [];
  const walk = (dir) => {
    let names;
    try { names = fs.readdirSync(dir).sort(); } catch { return; }
    for (const name of names) {
      const full = path.join(dir, name);
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full);
      else if (/\.(mjs|css|html)$/.test(name)) found.push(full);
    }
  };
  walk(path.join(root, 'renderers'));
  walk(path.join(root, 'assets'));
  return found;
}

let cache = null;
export function buildFingerprint(root = PKG_ROOT) {
  if (cache && cache.root === root) return cache.value;
  const hash = createHash('sha256').update(packageVersion(root));
  for (const file of outputFiles(root)) {
    hash.update(path.relative(root, file).split(path.sep).join('/'));
    hash.update(fs.readFileSync(file));
  }
  const value = hash.digest('hex').slice(0, 16);
  cache = { root, value };
  return value;
}

export function stampHtml({ root = PKG_ROOT, at = new Date() } = {}) {
  return `<meta name="generator" content="vibex ${esc(packageVersion(root))}">
<meta name="vibex:build" content="${esc(buildFingerprint(root))}">
<meta name="vibex:built" content="${esc(at.toISOString())}">`;
}

const meta = (name) => new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`, 'i');

// Reads a stamp back out of generated HTML. An unstamped file is not an error:
// it predates stamping, which is itself a reason to regenerate.
export function readStamp(html) {
  const text = String(html || '');
  const g = meta('generator').exec(text);
  const b = meta('vibex:build').exec(text);
  const t = meta('vibex:built').exec(text);
  const version = g && /^vibex\s+/i.test(g[1]) ? g[1].replace(/^vibex\s+/i, '').trim() : null;
  return { version, build: b ? b[1] : null, built: t ? t[1] : null, stamped: Boolean(version && b) };
}
