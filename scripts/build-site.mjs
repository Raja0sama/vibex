#!/usr/bin/env node
// Builds the public site into site/. Vercel runs this as its build command and
// CI runs the same script, so a green pull request and a green deploy cannot
// disagree about what "the site builds" means.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const cli = path.join('bin', 'vibex.mjs');
const out = path.join('site', 'demo');
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { stdio: 'inherit' });

fs.mkdirSync(out, { recursive: true });

// The showcase is the demo, not the bundled examples: a whole system in a
// domain nobody has to be taught, documented to the depth the tool is for.
run('dashboard', path.join(out, 'dashboard.html'), 'showcase',
  '--title', 'Relay',
  '--subtitle', 'A parcel network, documented end to end',
  '--repo', 'showcase');

const diagrams = fs.readdirSync('showcase')
  .filter((f) => /\.(c4|erd|endpoints|lifecycle)\.json$/.test(f))
  .sort();

for (const spec of diagrams) {
  run('render', path.join('showcase', spec), path.join(out, spec.replace(/\.json$/, '.html')));
}

// --no-lock: a lock file is an optimisation for local iteration. A published
// demo re-reads every anchor rather than trusting one.
run('docs', path.join('showcase', 'relay.docs.json'), 'showcase',
  '--repo', 'showcase', '--no-lock',
  '--md', path.join(out, 'relay.md'),
  '-o', path.join(out, 'docs.json'));

console.log(`\nsite/ ready — ${diagrams.length} diagrams, dashboard, docs.json, relay.md`);
