#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateSpec, formatReport, DIAGRAM_TYPES } from '../renderers/shared/validate.mjs';
import { renderSpec } from '../renderers/shared/render.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `vibeX — JSON spec → standalone HTML diagram (ERD, C4, API endpoints)

Usage:
  vibex validate <spec.json> [--json]
  vibex render   <spec.json> [out.html] [--open] [--json]
  vibex import openapi <openapi.json|yaml> [out.json] [--title "..."] [--all-types]
  vibex import graphql <schema.graphql>    [out.json] [--title "..."] [--erd]
  vibex import prisma  <schema.prisma>     [out.json] [--title "..."]
  vibex dashboard <out.html> <spec.json|dir>... [--title "..."] [--subtitle "..."] [--open] [--json]
                                  one HTML with every diagram, sidebar, overview, cross-links
  vibex demo [out-dir]          render the bundled examples (+ dashboard.html)
  vibex types                   list diagram types and schema paths
  vibex help                    this text

Exit codes: 0 ok, 1 validation errors, 2 usage / IO error.
Renderer warnings never fail a render; they print to stderr (or "warnings" in --json).`;

// --flag with no value: never swallows the next positional.
function boolFlag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}

// --flag <value>: the value is required and may not look like another flag.
function valueFlag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--')) fail(`${name} needs a value, e.g. ${name} "My title"`);
  args.splice(i, 2);
  return value;
}

function rejectUnknownFlags(args) {
  const unknown = args.filter((a) => a.startsWith('--'));
  if (unknown.length) fail(`Unknown option ${unknown.join(', ')}\n\n${HELP}`);
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { return fail(`Cannot read ${file}: ${e.message}`); }
}

function readJson(file) {
  const text = readText(file);
  try { return JSON.parse(text); } catch (e) { return fail(`Cannot parse JSON ${file}: ${e.message}`); }
}

function writeOut(file, content) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  } catch (e) { fail(`Cannot write ${file}: ${e.message}`); }
}

function fail(message, exitCode = 2) {
  process.stderr.write(`${message}\n`);
  process.exit(exitCode);
}

function openFile(file) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', file] : [file];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}

function cmdValidate(args) {
  const json = boolFlag(args, '--json');
  rejectUnknownFlags(args);
  const [file] = args;
  if (!file) fail(HELP);
  const spec = readJson(file);
  const report = validateSpec(spec);
  if (json) console.log(JSON.stringify({ ok: report.ok, diagram_type: spec.diagram_type, errors: report.errors, warnings: report.warnings }, null, 2));
  else console.log(formatReport(report));
  process.exit(report.ok ? 0 : 1);
}

function cmdRender(args) {
  const json = boolFlag(args, '--json');
  const open = boolFlag(args, '--open');
  rejectUnknownFlags(args);
  const [file, outArg] = args;
  if (!file) fail(HELP);
  const spec = readJson(file);
  const out = path.resolve(outArg || file.replace(/\.json$/i, '') + '.html');
  const { report, html, warnings, width, height } = renderSpec(spec);
  if (!report.ok) {
    if (json) console.log(JSON.stringify({ ok: false, errors: report.errors, warnings: report.warnings }, null, 2));
    else console.error(formatReport(report));
    process.exit(1);
  }
  writeOut(out, html);
  const allWarnings = [...report.warnings.map((w) => w.message), ...warnings];
  if (json) {
    console.log(JSON.stringify({ ok: true, output: out, diagram_type: spec.diagram_type, bytes: Buffer.byteLength(html), viewBox: [width, height], warnings: allWarnings }, null, 2));
  } else {
    for (const w of allWarnings) console.error(`warning ${w}`);
    console.log(out);
  }
  if (open) openFile(out);
}

async function cmdImport(args) {
  const title = valueFlag(args, '--title');
  const erd = boolFlag(args, '--erd');
  const allTypes = boolFlag(args, '--all-types');
  rejectUnknownFlags(args);
  const [kind, file, outArg] = args;
  if (!kind || !file) fail(HELP);
  const source = readText(file);
  const relPath = path.relative(process.cwd(), path.resolve(file)).split(path.sep).join('/');
  let spec;
  if (kind === 'openapi') {
    const { importOpenApi } = await import('../importers/openapi.mjs');
    const doc = await parseJsonOrYaml(source, file);
    spec = importOpenApi(doc, { title, allTypes, sourcePath: relPath });
  } else if (kind === 'graphql') {
    const { importGraphql } = await import('../importers/graphql.mjs');
    spec = importGraphql(source, { title, erd, sourcePath: relPath });
  } else if (kind === 'prisma') {
    const { importPrisma } = await import('../importers/prisma.mjs');
    spec = importPrisma(source, { title, sourcePath: relPath });
  } else {
    fail(`Unknown import kind "${kind}". Use openapi, graphql, or prisma.`);
  }
  const out = path.resolve(outArg || `${path.basename(file).replace(/\.[^.]+$/, '')}.${spec.diagram_type}.json`);
  writeOut(out, `${JSON.stringify(spec, null, 2)}\n`);
  const report = validateSpec(spec);
  console.error(formatReport(report));
  console.log(out);
  process.exit(report.ok ? 0 : 1);
}

async function parseJsonOrYaml(source, file) {
  try { return JSON.parse(source); } catch { /* fall through */ }
  let yaml;
  try { yaml = await import('yaml'); } catch (e) {
    fail(`${file} is not JSON and the "yaml" package is unavailable (${e.message}).\nRun: npm install --prefix ${root}   or convert the spec to JSON first.`);
  }
  try { return yaml.parse(source); } catch (e) {
    return fail(`Cannot parse ${file} as YAML: ${e.message}`);
  }
}

function collectSpecFiles(inputs) {
  const files = [];
  for (const input of inputs) {
    const full = path.resolve(input);
    if (!fs.existsSync(full)) fail(`No such file or directory: ${input}`);
    if (fs.statSync(full).isDirectory()) {
      for (const name of fs.readdirSync(full).filter((f) => f.endsWith('.json')).sort()) files.push(path.join(full, name));
    } else files.push(full);
  }
  return files;
}

async function cmdDashboard(args) {
  const title = valueFlag(args, '--title');
  const subtitle = valueFlag(args, '--subtitle');
  const open = boolFlag(args, '--open');
  const json = boolFlag(args, '--json');
  rejectUnknownFlags(args);
  const [outArg, ...inputs] = args;
  if (!outArg || !inputs.length) fail(HELP);
  const { renderDashboard } = await import('../renderers/shared/dashboard.mjs');
  const unreadable = [];
  const items = [];
  for (const file of collectSpecFiles(inputs)) {
    const name = path.basename(file).replace(/\.json$/i, '');
    let spec;
    try { spec = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { unreadable.push({ file: name, message: e.message }); continue; }
    if (spec && typeof spec === 'object' && spec.diagram_type) items.push({ file: name, spec });
  }
  for (const u of unreadable) console.error(`skipped ${u.file}: ${u.message}`);
  if (!items.length) fail('No diagram specs found (need JSON files with a diagram_type).');
  const { html, entries, problems, warnings } = renderDashboard(items, { title: title || 'Architecture', subtitle });
  for (const p of problems) console.error(`skipped ${p.file}: ${p.errors.map((e) => e.message).join('; ')}`);
  for (const w of warnings) console.error(`warning ${w}`);
  const out = path.resolve(outArg);
  writeOut(out, html);
  const skipped = [...unreadable.map((u) => u.file), ...problems.map((p) => p.file)];
  if (json) console.log(JSON.stringify({ ok: true, output: out, diagrams: entries.map((e) => ({ file: e.file, type: e.spec.diagram_type, title: e.spec.meta.title })), skipped, warnings }, null, 2));
  else console.log(out);
  if (open) openFile(out);
  if (problems.length || unreadable.length) process.exit(1);
}

async function cmdDemo(args) {
  rejectUnknownFlags(args);
  const outDir = path.resolve(args[0] || 'out');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) { fail(`Cannot create ${outDir}: ${e.message}`); }
  const examplesDir = path.join(root, 'examples');
  const { renderDashboard } = await import('../renderers/shared/dashboard.mjs');
  const dash = renderDashboard(
    fs.readdirSync(examplesDir).filter((f) => f.endsWith('.json')).map((name) => ({ file: name.replace(/\.json$/, ''), spec: readJson(path.join(examplesDir, name)) })),
    { title: 'Shop platform', subtitle: 'Example dashboard: architecture, data model, APIs' },
  );
  writeOut(path.join(outDir, 'dashboard.html'), dash.html);
  console.log(path.join(outDir, 'dashboard.html'));
  for (const name of fs.readdirSync(examplesDir).filter((f) => f.endsWith('.json'))) {
    const spec = readJson(path.join(examplesDir, name));
    const { report, html, warnings } = renderSpec(spec);
    if (!report.ok) { console.error(`${name}: ${formatReport(report)}`); continue; }
    const out = path.join(outDir, name.replace(/\.json$/, '.html'));
    writeOut(out, html);
    for (const w of warnings) console.error(`warning ${name}: ${w}`);
    console.log(out);
  }
}

function cmdTypes() {
  for (const type of DIAGRAM_TYPES) {
    console.log(`${type.padEnd(10)} schemas/${type}.schema.json   examples/${fs.readdirSync(path.join(root, 'examples')).find((f) => f.endsWith(`.${type}.json`)) || ''}`);
  }
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case 'validate': cmdValidate(rest); break;
  case 'render': cmdRender(rest); break;
  case 'import': await cmdImport(rest); break;
  case 'dashboard': await cmdDashboard(rest); break;
  case 'demo': await cmdDemo(rest); break;
  case 'types': cmdTypes(); break;
  case undefined: case 'help': case '-h': case '--help': console.log(HELP); break;
  default: fail(`Unknown command "${command}"\n\n${HELP}`);
}
