// The changelog as a dashboard panel.
//
// The reason it belongs here rather than only in a file: this is the one place
// a reader can follow "this release touched relay.erd" straight into the
// diagram it touched, and see a claim's wording change next to the claim.
import { esc } from '../shared/utils.mjs';

const SECTION_NOTE = {
  breaking: 'Read these before upgrading.',
  internal: 'Nothing here changes how the tool behaves.',
};

function commitHref(entry, repository) {
  const url = repository?.url?.replace(/\/+$/, '').replace(/\.git$/, '');
  if (!url || !/^https?:\/\/(www\.)?(github|gitlab)\.com\//i.test(url)) return null;
  return `${url}${/gitlab\.com/i.test(url) ? '/-/commit/' : '/commit/'}${entry.commit}`;
}

function when(at) {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return '';
  return new Date(t).toISOString().slice(0, 10);
}

function entryHtml(entry, { repository, resolveSpec }) {
  const href = commitHref(entry, repository);
  const sha = href
    ? `<a class="sha" href="${esc(href)}" target="_blank" rel="noreferrer noopener">${esc(entry.short)}</a>`
    : `<span class="sha">${esc(entry.short)}</span>`;

  // A spec chip is the point of showing this next to the diagrams.
  const specs = (entry.specs || []).map((id) => {
    const target = resolveSpec(id);
    return target
      ? `<button type="button" class="chip link" data-goto-panel="${esc(String(target.panel))}">${esc(target.label)}</button>`
      : `<span class="chip">${esc(id)}</span>`;
  }).join('');

  const body = entry.body
    ? `<details class="commit-body"><summary>why</summary><pre>${esc(entry.body.replace(/\n*Co-Authored-By:.*$/s, '').trim())}</pre></details>`
    : '';

  return `<li class="cl-entry${entry.breaking ? ' breaking' : ''}">
  <p class="t">${esc(entry.title)}${entry.scope ? ` <em>(${esc(entry.scope)})</em>` : ''}</p>
  <div class="meta">${sha}<span class="who">${esc(entry.author || '')}</span><span class="when">${esc(when(entry.at))}</span>${entry.grouped_by === 'paths' ? '<span class="guessed" title="This section was inferred from the files the commit touched, not from its message.">sorted by paths</span>' : ''}</div>
  ${specs ? `<div class="specs">${specs}</div>` : ''}
  ${body}
</li>`;
}

function impactHtml(log) {
  const c = log.impact.claims;
  if (!c) {
    return `<p class="empty-note">Run <code>vibex changelog --specs &lt;dir&gt;</code> to see what these commits did to the documentation.</p>`;
  }
  const rows = [];
  const ids = (list) => list.map((id) => `<code>${esc(id)}</code>`).join(', ');
  if (c.added?.length) rows.push(`<li><b>${c.added.length} written</b> ${ids(c.added)}</li>`);
  if (c.reworded?.length) {
    rows.push(`<li><b>${c.reworded.length} reworded</b><ul class="reword">${c.reworded.map((r) => `
      <li><code>${esc(r.id)}</code><span class="was">${esc(r.was)}</span><span class="now">${esc(r.now)}</span></li>`).join('')}</ul></li>`);
  }
  if (c.superseded?.length) rows.push(`<li><b>${c.superseded.length} superseded</b> ${c.superseded.map((s) => `<code>${esc(s.id)}</code> replaces <code>${esc(s.replaces)}</code>`).join(', ')}</li>`);
  // Removal is the line worth a reader stopping on.
  if (c.removed?.length) rows.push(`<li class="warn"><b>${c.removed.length} removed</b> ${ids(c.removed)} — check these were meant to go, not lost in a rewrite.</li>`);
  const derived = (c.derived_added || 0) + (c.derived_removed || 0);
  if (derived) rows.push(`<li class="muted">${c.derived_added || 0} derived fact(s) appeared and ${c.derived_removed || 0} disappeared as the diagrams changed. Computed, not written, so not listed.</li>`);
  if (!rows.length) rows.push('<li class="muted">Nothing. No claim was added, removed, reworded or superseded.</li>');
  return `<ul class="cl-impact">${rows.join('')}</ul>`;
}

export function renderChangelogPanel(log, { repository = null, resolveSpec = () => null, panelId = 'changelog' } = {}) {
  // The artefact knows which repository these commits came from; a spec may
  // describe a different one entirely.
  const repo = log.repository || repository;
  const byId = new Map(log.entries.map((e) => [e.commit, e]));
  const ctx = { repository: repo, resolveSpec };
  const { from, to } = log.range;

  let body = '';
  for (const section of log.sections) {
    body += `<section class="docs-section"><h2>${esc(section.title)}</h2>`;
    if (SECTION_NOTE[section.id]) body += `<p class="lead">${esc(SECTION_NOTE[section.id])}</p>`;
    body += `<ul class="cl-entries">${section.entries.map((id) => entryHtml(byId.get(id), ctx)).filter(Boolean).join('')}</ul></section>`;
  }
  if (!log.sections.length) body = '<p class="empty-note">No commits in this range.</p>';

  body += `<section class="docs-section"><h2>What this did to the documentation</h2>${impactHtml(log)}</section>`;

  const i = log.impact;
  const aside = `<aside>
  <section><h2>This range</h2><div class="stats">
    <b>${i.commits}</b> commit${i.commits === 1 ? '' : 's'}<br>
    <b>${i.authors.length}</b> author${i.authors.length === 1 ? '' : 's'}<br>
    <b>${i.specs_changed.length}</b> spec${i.specs_changed.length === 1 ? '' : 's'} touched
  </div></section>
  ${i.grouping === 'inferred' ? `<section><h2>About the sections</h2><p class="muted small">These were inferred from the files each commit touched, not from its message — this history does not use conventional-commit prefixes. Treat the grouping as a rough sort, not the author's intent.</p></section>` : ''}
  ${i.specs_changed.length ? `<section><h2>Specs touched</h2><div class="chips">${i.specs_changed.map((id) => {
    const t = resolveSpec(id);
    return t ? `<button type="button" class="chip link" data-goto-panel="${esc(String(t.panel))}">${esc(t.label)}</button>` : `<span class="chip">${esc(id)}</span>`;
  }).join('')}</div></section>` : ''}
  <section><h2>Built</h2><p class="muted small">${esc(log.generated_at)}<br>${esc(log.generator || '')}</p></section>
</aside>`;

  return `
<section class="panel docs" data-panel="${esc(panelId)}">
  <div class="docs-shell">
    <header class="toolbar">
      <div class="titles">
        <h1>Changes</h1>
        <span class="type-badge changelog">changelog</span>
        <p class="sub">${from ? `${esc(from)} … ${esc(to)}` : `up to ${esc(to)}`}</p>
      </div>
    </header>
    <div class="docs-body">
      <article class="docs-main">${body}</article>
      ${aside}
    </div>
  </div>
</section>`;
}

export function changelogNavHtml(log, panelId = 'changelog') {
  return `<div class="group"><h2>Changes</h2>
    <a href="#${esc(panelId)}" data-panel="${esc(panelId)}" data-type="changelog"><span class="dot"></span><span class="t">${esc(log.range.from ? `${log.range.from} … ${log.range.to}` : log.range.to)}</span><span class="n">${log.impact.commits}</span></a>
  </div>`;
}
