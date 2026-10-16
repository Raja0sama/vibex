// A workspace is the folder above several repos. Each repo keeps its own specs
// (or a shared folder holds specs for all of them); this finds them, groups
// them by the top-level folder they live in, and draws the page that lists the
// groups. Building each group's dashboard is the dashboard's job, not this one.
import fs from 'node:fs';
import path from 'node:path';
import { esc } from './utils.mjs';
import { stampHtml } from './stamp.mjs';
import { TYPE_LABEL, TYPE_ORDER } from './dashboard.mjs';

export const SITE_MARKER = '.vibex-site.json';
const SPEC_FILE = /\.(erd|c4|endpoints|lifecycle|sequence|links|docs)\.json$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', 'target', 'tmp', '__pycache__', 'venv']);
const MAX_DEPTH = 6;

export function slugOf(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '') || 'repo';
}

function specFilesUnder(dir, depth = 0, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  // A built site holds rendered copies, not sources; reading it would list everything twice.
  if (depth > 0 && entries.some((e) => e.name === SITE_MARKER)) return out;
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name) || depth >= MAX_DEPTH) continue;
      specFilesUnder(full, depth + 1, out);
    } else if (e.isFile() && (SPEC_FILE.test(e.name) || e.name === 'changelog.json')) {
      out.push(full);
    }
  }
  return out;
}

// One group per top-level folder that holds specs. Specs sitting in the
// workspace root itself form a "shared" group.
export function findWorkspace(rootDir, { exclude = [] } = {}) {
  const root = path.resolve(rootDir);
  const skip = new Set(exclude.map((p) => path.resolve(p)));
  const groups = [];
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return { root, groups }; }
  const top = entries.filter((e) => e.isFile() && (SPEC_FILE.test(e.name) || e.name === 'changelog.json')).map((e) => path.join(root, e.name));
  if (top.some((f) => SPEC_FILE.test(f))) groups.push({ name: 'shared', dir: root, isRepo: fs.existsSync(path.join(root, '.git')), files: top });
  for (const e of entries.filter((x) => x.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = path.join(root, e.name);
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name) || skip.has(dir)) continue;
    const files = specFilesUnder(dir, 1);
    if (!files.some((f) => SPEC_FILE.test(f))) continue;
    groups.push({ name: e.name, dir, isRepo: fs.existsSync(path.join(dir, '.git')), files });
  }
  const seen = new Map();
  for (const g of groups) {
    let slug = slugOf(g.name);
    const n = (seen.get(slug) || 0) + 1;
    seen.set(slug, n);
    if (n > 1) slug = `${slug}-${n}`;
    g.slug = slug;
  }
  return { root, groups };
}

const STYLE = `
:root{--bg:#faf9f5;--surface:#fff;--border:#ddd8cd;--text:#1c1a17;--text-2:#4e4a44;--text-3:#6b6459;--accent:#2b6cb0;--warn:#b7791f;
--font-sans:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;--font-mono:ui-monospace,"SF Mono",Menlo,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#121316;--surface:#1f2125;--border:#3d414a;--text:#f0f0f2;--text-2:#b9bcc2;--text-3:#8a8e95;--accent:#63b3ed;--warn:#ecc94b}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 var(--font-sans)}
main{max-width:960px;margin:0 auto;padding:48px 16px}
h1{font-size:26px;margin:0 0 4px}
.sub{color:var(--text-3);margin:0 0 32px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
a.card{display:block;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:18px;color:inherit;text-decoration:none}
a.card:hover,a.card:focus-visible{border-color:var(--accent);outline:none}
.card h2{font-size:16px;margin:0 0 2px}
.card .path{color:var(--text-3);font:12px var(--font-mono);margin:0 0 12px;word-break:break-all}
.card ul{list-style:none;margin:0;padding:0;color:var(--text-2)}
.card li{display:flex;justify-content:space-between;padding:2px 0}
.card li b{font-weight:600;color:var(--text)}
.card .skipped{color:var(--warn);margin-top:10px;font-size:12px}
footer{color:var(--text-3);font-size:12px;margin-top:40px}
`;

// groups: [{ name, slug, rel, counts: { [type]: n }, skipped }]
export function renderWorkspaceIndex(groups, { title = 'Architecture', subtitle = '' } = {}) {
  const label = { ...TYPE_LABEL, docs: 'Documentation' };
  const order = [...TYPE_ORDER, 'docs'];
  const cards = groups.map((g) => {
    const rows = order.filter((t) => g.counts[t]).map((t) => `<li><span>${esc(label[t])}</span><b>${g.counts[t]}</b></li>`).join('');
    const skipped = g.skipped ? `<div class="skipped">${g.skipped} spec${g.skipped === 1 ? '' : 's'} skipped; see the build output</div>` : '';
    return `<a class="card" href="./${esc(g.slug)}/"><h2>${esc(g.name)}</h2><p class="path">${esc(g.rel)}</p><ul>${rows}</ul>${skipped}</a>`;
  }).join('\n');
  const total = groups.length;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${stampHtml()}
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
<p class="sub">${esc(subtitle || `${total} ${total === 1 ? 'repository' : 'repositories'}`)}</p>
<div class="grid">
${cards}
</div>
<footer>Built with vibeX. Each card opens that repository's dashboard.</footer>
</main>
</body>
</html>
`;
}
