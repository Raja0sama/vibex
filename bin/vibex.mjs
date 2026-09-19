#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateSpec, formatReport, DIAGRAM_TYPES } from '../renderers/shared/validate.mjs';
import { renderSpec } from '../renderers/shared/render.mjs';
import { buildGraph, specId } from '../renderers/docs/graph.mjs';
import { checkAnchor } from '../renderers/docs/anchors.mjs';
import { toMarkdown } from '../renderers/docs/to-markdown.mjs';
import { head, dirtyPaths, changedSince, shortSha, prefix as gitPrefix, underPrefix } from '../renderers/docs/git.mjs';
import { readCommits, buildChangelog, resolve as resolveRef, diffClaims } from '../renderers/changelog/from-git.mjs';
import { changelogToMarkdown } from '../renderers/changelog/to-markdown.mjs';
import { planCheck, mergeLock, verifiedCommits, emptyLock } from '../renderers/docs/incremental.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `vibeX — you vibed it into existence; this shows you what you built
        JSON spec → standalone HTML diagram (ERD, C4, API endpoints, lifecycle)

Usage:
  vibex validate <spec.json> [--json]
  vibex render   <spec.json> [out.html] [--open] [--json]
  vibex import openapi <openapi.json|yaml> [out.json] [--title "..."] [--all-types]
  vibex import graphql <schema.graphql>    [out.json] [--title "..."] [--erd]
  vibex import prisma  <schema.prisma>     [out.json] [--title "..."]
  vibex dashboard <out.html> <spec.json|dir>... [--title "..."] [--subtitle "..."] [--repo <dir>] [--open] [--json]
                                  one HTML with every diagram, sidebar, overview, cross-links.
                                  A *.docs.json in the set becomes a Documentation panel;
                                  --repo lets its anchored claims be checked.
  vibex docs <docs.json> <spec.json|dir>... [-o docs.json] [--md doc.md] [--repo <dir>]
                 [--check] [--reanchor] [--lock docs.lock.json] [--no-lock] [--json]
                                  build the fact graph: derived facts + authored claims,
                                  each with provenance and a computed confidence.
                                  Uses git to re-read only the anchors whose files moved
                                  since the commit recorded in the lock file.
  vibex changelog [<from>..<to>] [-o changelog.json] [--md CHANGES.md] [--specs <dir>]
                  [--repo <dir>] [--title "..."] [--merges] [--json]
                                  build a release list from commit history, and — with
                                  --specs — what those commits did to the documentation
  vibex demo [out-dir]          render the bundled examples (+ dashboard.html)
  vibex types                   list diagram types and schema paths
  vibex help                    this text

Exit codes: 0 ok, 1 validation errors, 2 usage / IO error.
  docs --check also exits 1 when any claim is stale, broken, or expired.
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

// Collect diagram specs from files and directories, keyed by their spec id
// (meta.id, else the filename) so docs claims can address them.
function loadSpecs(paths) {
  const specs = new Map();
  for (const p of paths) {
    const stat = fs.statSync(p, { throwIfNoEntry: false });
    if (!stat) fail(`No such file or directory: ${p}`);
    const files = stat.isDirectory()
      ? fs.readdirSync(p).filter((f) => f.endsWith('.json')).map((f) => path.join(p, f))
      : [p];
    for (const file of files) {
      const spec = readJson(file);
      if (!DIAGRAM_TYPES.includes(spec.diagram_type)) continue;
      specs.set(specId(spec, path.basename(file).replace(/\.json$/i, '')), spec);
    }
  }
  return specs;
}

// Reads the working tree for anchored claims. Confined to the repo root: an
// anchor path that escapes it reads as missing rather than as a file.
function anchorStatusFor(docsSpec, repoRoot, only = null) {
  const repo = path.resolve(repoRoot);
  const readFile = (rel) => {
    const abs = path.resolve(repo, rel);
    if (!abs.startsWith(repo + path.sep)) return null;
    try { return fs.readFileSync(abs, 'utf8'); } catch { return null; }
  };
  const status = new Map();
  for (const c of docsSpec.claims || []) {
    if (c.source?.kind !== 'anchored') continue;
    if (only && !only.has(c.id)) continue;
    status.set(c.id, checkAnchor(c.source, readFile));
  }
  return status;
}

// git, run inside the repo. Any failure returns null, which every caller reads
// as "unknown" and resolves by checking more, never less.
function gitRunner(repoRoot) {
  return (args) => {
    try {
      return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { return null; }
  };
}

// Re-check only what git says moved; carry the rest forward from the lock.
function checkAnchorsIncremental(docsSpec, repoRoot, lockPath) {
  const run = gitRunner(repoRoot);
  const commit = head(run);
  const lock = lockPath && fs.existsSync(lockPath)
    ? (() => { try { return JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { return null; } })()
    : null;

  const pre = gitPrefix(run);
  const dirty = underPrefix(dirtyPaths(run), pre);
  const changed = underPrefix(lock?.commit ? changedSince(run, lock.commit) : null, pre);
  const plan = planCheck({ claims: docsSpec.claims, lock, commit, changed, dirty });

  const fresh = anchorStatusFor(docsSpec, repoRoot, plan.recheck);
  const status = new Map(fresh);
  for (const [id, prev] of plan.reuse) status.set(id, { ...prev, reused: true });

  return { status, commit, lock, plan, nextLock: mergeLock({ claims: docsSpec.claims, lock, statuses: status, commit }) };
}

// Reads the docs specs as they stood at a ref, so a release can say what it did
// to the documentation and not only to the code.
function claimsAt(run, ref, dir) {
  const listing = run(['ls-tree', '-r', '--name-only', ref, '--', dir]);
  if (listing === null) return null;
  const specs = new Map();
  const docs = [];
  for (const file of listing.split('\n').map((l) => l.trim()).filter((l) => l.endsWith('.json'))) {
    const text = run(['show', `${ref}:${file}`]);
    if (text === null) continue;
    let spec;
    try { spec = JSON.parse(text); } catch { continue; }
    if (!spec?.diagram_type || !validateSpec(spec).ok) continue;
    if (spec.diagram_type === 'docs') docs.push(spec);
    else specs.set(specId(spec, path.basename(file).replace(/\.json$/i, '')), spec);
  }
  return docs.flatMap((d) => buildGraph(d, { specs }).claims);
}

function cmdChangelog(args) {
  const asJson = boolFlag(args, '--json');
  const includeMerges = boolFlag(args, '--merges');
  const outArg = valueFlag(args, '-o') || valueFlag(args, '--out');
  const mdArg = valueFlag(args, '--md');
  const titleArg = valueFlag(args, '--title');
  const specDir = valueFlag(args, '--specs');
  const repoArg = valueFlag(args, '--repo');
  rejectUnknownFlags(args);

  const repo = path.resolve(repoArg || process.cwd());
  const run = gitRunner(repo);
  const [rangeArg] = args;
  // "v1.0..main" or just "main"; with neither, everything reachable from HEAD.
  const [fromRaw, toRaw] = String(rangeArg || 'HEAD').split('..');
  const to = toRaw || (rangeArg && rangeArg.includes('..') ? 'HEAD' : fromRaw) || 'HEAD';
  const from = rangeArg && rangeArg.includes('..') ? fromRaw : null;

  const commits = readCommits(run, from, to, { includeMerges });
  if (commits === null) fail(`Cannot read git history for ${rangeArg || to} in ${repo}. Is it a repository, and does that range exist?`);

  const fromCommit = from ? resolveRef(run, from) : null;
  const toCommit = resolveRef(run, to);

  // Only meaningful with both ends and somewhere to look for specs.
  let claimDiff = null;
  if (specDir && fromCommit && toCommit) {
    const before = claimsAt(run, from, specDir);
    const after = claimsAt(run, to, specDir);
    if (before && after) claimDiff = diffClaims(before, after);
    else console.error(`warning could not read ${specDir} at both ends of the range; the documentation diff is omitted`);
  }

  const pkg = readJson(path.join(root, 'package.json'));
  const log = buildChangelog({ commits, from, to, fromCommit, toCommit, generator: `vibex ${pkg.version}`, claimDiff });

  const out = path.resolve(outArg || 'changelog.json');
  writeOut(out, `${JSON.stringify(log, null, 2)}\n`);

  let mdOut = null;
  if (mdArg) {
    const remote = run(['remote', 'get-url', 'origin']);
    const repository = remote ? { url: remote.trim() } : readRepositoryFrom(specDir);
    mdOut = path.resolve(mdArg);
    writeOut(mdOut, changelogToMarkdown(log, { repository, title: titleArg || null }));
  }

  if (asJson) {
    console.log(JSON.stringify({ ok: true, out, ...(mdOut ? { markdown: mdOut } : {}), impact: log.impact }, null, 2));
  } else {
    console.log(out);
    if (mdOut) console.log(mdOut);
    const i = log.impact;
    console.error(`${i.commits} commit(s), ${i.authors.length} author(s), ${i.specs_changed.length} spec(s) touched`
      + `${i.grouping === 'inferred' ? ' — sections inferred from file paths, not commit messages' : ''}`);
    if (i.claims) {
      const c = i.claims;
      console.error(`claims: +${c.added.length} added, ${c.reworded.length} reworded, ${c.superseded.length} superseded, -${c.removed.length} removed`);
    }
  }
}

// The repository URL lives in the specs, so commit links work without config.
function readRepositoryFrom(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    try {
      const spec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (spec?.meta?.repository?.url) return spec.meta.repository;
    } catch { /* not a spec */ }
  }
  return null;
}

function cmdDocs(args) {
  const asJson = boolFlag(args, '--json');
  const check = boolFlag(args, '--check');
  const reanchor = boolFlag(args, '--reanchor');
  const outArg = valueFlag(args, '-o') || valueFlag(args, '--out');
  const mdArg = valueFlag(args, '--md');
  const lockArg = valueFlag(args, '--lock');
  const noLock = boolFlag(args, '--no-lock');
  const repo = path.resolve(valueFlag(args, '--repo') || process.cwd());
  rejectUnknownFlags(args);
  const [docsFile, ...specPaths] = args;
  if (!docsFile) fail(HELP);

  const docsSpec = readJson(docsFile);
  const report = validateSpec(docsSpec);
  if (!report.ok) {
    if (asJson) console.log(JSON.stringify({ ok: false, errors: report.errors, warnings: report.warnings }, null, 2));
    else console.error(formatReport(report));
    process.exit(1);
  }

  const specs = loadSpecs(specPaths.length ? specPaths : [path.dirname(docsFile)]);

  // Anchor checking is the whole point of an anchored claim, so read the tree
  // here rather than trusting what the file says about itself — but only the
  // files git says have moved since the last run.
  const lockPath = path.resolve(lockArg || path.join(path.dirname(docsFile), 'docs.lock.json'));
  const { status: anchorStatus, commit, plan, nextLock } = checkAnchorsIncremental(docsSpec, repo, noLock ? null : lockPath);

  if (reanchor) {
    let updated = 0;
    for (const c of docsSpec.claims || []) {
      const st = anchorStatus.get(c.id);
      if (st?.state !== 'changed') continue;
      c.source.hash = st.hash;
      anchorStatus.set(c.id, { state: 'match', detail: '', commit });
      if (nextLock.claims[c.id]) nextLock.claims[c.id] = { state: 'match', hash: st.hash, commit: commit || null };
      updated += 1;
    }
    writeOut(path.resolve(docsFile), `${JSON.stringify(docsSpec, null, 2)}\n`);
    console.error(`reanchored ${updated} claim(s) in ${docsFile} — re-read each one before trusting it`);
  }

  const pkg = readJson(path.join(root, 'package.json'));
  const graph = buildGraph(docsSpec, {
    specs,
    anchorStatus,
    commit,
    verifiedCommits: verifiedCommits(nextLock),
    generator: `vibex ${pkg.version}`,
  });
  if (!noLock) writeOut(lockPath, `${JSON.stringify(nextLock, null, 2)}\n`);
  const out = path.resolve(outArg || path.join(path.dirname(docsFile), 'docs.json'));
  writeOut(out, `${JSON.stringify(graph, null, 2)}\n`);
  let mdOut = null;
  if (mdArg) { mdOut = path.resolve(mdArg); writeOut(mdOut, toMarkdown(graph)); }

  const { counts, unknown } = graph.coverage;
  // A proposal has nothing to drift from, so --check has nothing to say about it.
  const unresolved = counts.stale + counts.broken + counts.expired;

  if (asJson) {
    console.log(JSON.stringify({ ok: !check || unresolved === 0, out, ...(mdOut ? { markdown: mdOut } : {}), coverage: graph.coverage, warnings: report.warnings }, null, 2));
  } else {
    console.log(out);
    if (mdOut) console.log(mdOut);
    console.error(`${counts.claims} claims — ${counts.verified} verified, ${counts.asserted} asserted`
      + `${counts.proposed ? `, ${counts.proposed} proposed` : ''}`
      + `, ${counts.stale} stale, ${counts.broken} broken, ${counts.expired} expired`);
    if (graph.project?.proposed) console.error('this document is a proposal: nothing in it describes something that exists');
    console.error(`anchors: ${plan.recheck.size} re-read, ${plan.reuse.size} reused (${plan.reason})${commit ? ` at ${shortSha(commit)}` : ''}`);
    for (const c of graph.claims) {
      if (['stale', 'broken', 'expired'].includes(c.confidence)) console.error(`  ${c.confidence.padEnd(8)} ${c.id}: ${c.detail}`);
    }
    for (const u of unknown) console.error(`  unknown  ${u.what}: ${u.why}`);
  }
  process.exit(check && unresolved ? 1 : 0);
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
  const repoArg = valueFlag(args, '--repo');
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
  const docsCount = items.filter((i) => i.spec.diagram_type === 'docs').length;
  if (docsCount && !repoArg) console.error('warning no --repo given: anchored claims cannot be checked and will read as unverifiable');
  // Resolved per document: claim ids are only unique within one docs spec.
  const anchorStatus = docsCount ? ((spec) => anchorStatusFor(spec, repoArg || process.cwd())) : null;
  // The commit the reader is looking at, not the branch the spec names. It ends
  // up in every "report this" link, so an issue points at an exact tree.
  const commit = docsCount ? head(gitRunner(path.resolve(repoArg || process.cwd()))) : null;
  const { html, entries, problems, warnings } = renderDashboard(items, { title: title || 'Architecture', subtitle, anchorStatus, commit });
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
  const examples = fs.readdirSync(examplesDir).filter((f) => f.endsWith('.json'))
    .map((name) => ({ file: name.replace(/\.json$/, ''), spec: readJson(path.join(examplesDir, name)) }));
  // The example's claims are anchored to the fixture repo shipped for the tests,
  // so the demo shows a document whose anchors actually check out.
  const fixtureRepo = path.join(root, 'examples/shop-repo');
  const dash = renderDashboard(examples, {
    title: 'Shop platform',
    subtitle: 'Example dashboard: architecture, data model, APIs, documentation',
    anchorStatus: (spec) => anchorStatusFor(spec, fixtureRepo),
    commit: head(gitRunner(root)),
  });
  writeOut(path.join(outDir, 'dashboard.html'), dash.html);
  console.log(path.join(outDir, 'dashboard.html'));
  for (const { file: name, spec } of examples) {
    if (!DIAGRAM_TYPES.includes(spec.diagram_type)) continue; // docs live in the dashboard
    const { report, html, warnings } = renderSpec(spec);
    if (!report.ok) { console.error(`${name}: ${formatReport(report)}`); continue; }
    const out = path.join(outDir, `${name}.html`);
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
  case 'docs': cmdDocs(rest); break;
  case 'changelog': cmdChangelog(rest); break;
  case 'demo': await cmdDemo(rest); break;
  case 'types': cmdTypes(); break;
  case undefined: case 'help': case '-h': case '--help': console.log(HELP); break;
  default: fail(`Unknown command "${command}"\n\n${HELP}`);
}
