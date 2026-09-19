// A changelog built from commits, which is the only record of a release that
// cannot be written after the fact.
//
// Everything here takes an injected `run(args) -> string | null`, so the module
// executes no git itself and a test can script an entire history. `null` means
// the command failed, which is always "we do not know" rather than "nothing".

const US = '\u001f'; // between fields
const RS = '\u001e'; // between commits

export const SECTIONS = [
  { id: 'breaking', title: 'Breaking' },
  { id: 'added', title: 'Added' },
  { id: 'changed', title: 'Changed' },
  { id: 'fixed', title: 'Fixed' },
  { id: 'docs', title: 'Documentation' },
  { id: 'internal', title: 'Internal' },
];

// Conventional-commit prefixes when a project uses them. Most do not, so this
// is a hint and never the only signal.
const TYPE_SECTION = {
  feat: 'added',
  fix: 'fixed',
  perf: 'changed',
  refactor: 'changed',
  docs: 'docs',
  test: 'internal',
  build: 'internal',
  ci: 'internal',
  chore: 'internal',
  style: 'internal',
};

// Falls back to what the commit actually touched, which works on prose history.
// Internal means *every* path was internal: a commit that changes a renderer and
// a workflow changed the tool, whatever else it touched.
const INTERNAL = /^(test|\.github|showcase|examples)\//;
const DOCS_ONLY = /(\.docs\.json$)|^(docs\/|README|CHANGELOG|SKILL)/i;

const BREAKING_BODY = /^BREAKING[ -]CHANGE:/m;

export function parseSubject(subject) {
  const m = /^(\w+)(\([^)]*\))?(!)?:\s*(.+)$/.exec(subject || '');
  if (!m) return { type: null, scope: null, breaking: false, title: String(subject || '').trim() };
  return {
    type: m[1].toLowerCase(),
    scope: m[2] ? m[2].slice(1, -1) : null,
    breaking: Boolean(m[3]),
    title: m[4].trim(),
  };
}

function classify({ type, breaking }, paths, body) {
  if (breaking || BREAKING_BODY.test(body || '')) return { section: 'breaking', by: 'convention' };
  if (type && TYPE_SECTION[type]) return { section: TYPE_SECTION[type], by: 'convention' };

  const all = paths || [];
  if (!all.length) return { section: 'changed', by: 'default' };
  const visible = all.filter((p) => !INTERNAL.test(p));
  if (!visible.length) return { section: 'internal', by: 'paths' };
  if (visible.every((p) => DOCS_ONLY.test(p))) return { section: 'docs', by: 'paths' };
  // Added vs changed vs fixed genuinely cannot be read off a file list. Saying
  // "changed" and admitting the guess beats inventing a confident "added".
  return { section: 'changed', by: 'paths' };
}

export function resolve(run, ref) {
  const out = run(['rev-parse', ref]);
  return out ? out.trim() : null;
}

// One `git log` rather than one per commit: a release with three hundred
// commits should not be three hundred processes.
export function readCommits(run, from, to = 'HEAD', { includeMerges = false } = {}) {
  const range = from ? `${from}..${to}` : to;
  const args = ['log', range, '--name-only', `--format=${RS}%H${US}%an${US}%aI${US}%s${US}%b${US}`];
  if (!includeMerges) args.push('--no-merges');
  const out = run(args);
  if (out === null) return null;

  const commits = [];
  for (const chunk of out.split(RS)) {
    if (!chunk.trim()) continue;
    const parts = chunk.split(US);
    const sha = (parts[0] || '').trim();
    if (!sha) continue;
    commits.push({
      sha,
      author: parts[1] || '',
      at: parts[2] || '',
      subject: parts[3] || '',
      body: (parts[4] || '').trim(),
      paths: (parts[5] || '').split('\n').map((l) => l.trim()).filter(Boolean),
    });
  }
  return commits;
}

// A spec file that changed is the part of a release this tool can speak to.
const SPEC_RE = /(?:^|\/)([A-Za-z0-9_.-]+)\.(erd|c4|endpoints|lifecycle|docs)\.json$/;

export function specsTouched(paths) {
  const out = new Set();
  for (const p of paths || []) {
    const m = SPEC_RE.exec(p);
    if (m) out.add(`${m[1]}.${m[2]}`);
  }
  return [...out];
}

export function buildChangelog({
  commits, from, to, fromCommit, toCommit, generator = 'vibex', now = Date.now(), claimDiff = null,
}) {
  const entries = (commits || []).map((c) => {
    const parsed = parseSubject(c.subject);
    const specs = specsTouched(c.paths);
    const breaking = parsed.breaking || BREAKING_BODY.test(c.body || '');
    const { section, by } = classify(parsed, c.paths, c.body);
    return {
      commit: c.sha,
      short: c.sha.slice(0, 7),
      title: parsed.title,
      ...(parsed.scope ? { scope: parsed.scope } : {}),
      ...(c.body ? { body: c.body } : {}),
      author: c.author,
      at: c.at,
      section,
      // How the section was decided, so a reader knows which groupings are the
      // author's intent and which are the tool's guess.
      grouped_by: by,
      ...(specs.length ? { specs } : {}),
      ...(breaking ? { breaking: true } : {}),
    };
  });

  const sections = SECTIONS
    .map((s) => ({ ...s, entries: entries.filter((e) => e.section === s.id).map((e) => e.commit) }))
    .filter((s) => s.entries.length);

  return {
    schema_version: 1,
    artifact: 'changelog',
    generated_at: new Date(now).toISOString(),
    generator,
    range: { from: from || null, to, from_commit: fromCommit || null, to_commit: toCommit || null },
    sections,
    entries,
    impact: {
      commits: entries.length,
      authors: [...new Set(entries.map((e) => e.author).filter(Boolean))].sort(),
      specs_changed: [...new Set(entries.flatMap((e) => e.specs || []))].sort(),
      // A release whose sections were all guessed from file lists should say so.
      grouping: entries.some((e) => e.grouped_by === 'convention') ? 'mixed' : 'inferred',
      ...(claimDiff ? { claims: claimDiff } : {}),
    },
  };
}

// What a release did to the documentation, which is the thing a reader of a
// changelog cannot otherwise see.
const authored = (c) => c?.source?.kind === 'anchored' || c?.source?.kind === 'asserted';

export function diffClaims(before, after) {
  const b = new Map((before || []).map((c) => [c.id, c]));
  const a = new Map((after || []).map((c) => [c.id, c]));
  const addedAll = [...a.keys()].filter((id) => !b.has(id));
  const removedAll = [...b.keys()].filter((id) => !a.has(id));
  return {
    // Authored claims are what someone decided; derived ones simply followed
    // from a spec changing, and listing a hundred of them buries the news.
    added: addedAll.filter((id) => authored(a.get(id))),
    removed: removedAll.filter((id) => authored(b.get(id))),
    derived_added: addedAll.filter((id) => !authored(a.get(id))).length,
    derived_removed: removedAll.filter((id) => !authored(b.get(id))).length,
    superseded: [...a.values()]
      .filter((c) => c.supersedes && !b.get(c.id)?.supersedes)
      .map((c) => ({ id: c.id, replaces: c.supersedes })),
    reworded: [...a.values()]
      .filter((c) => b.has(c.id) && b.get(c.id).text !== c.text)
      .map((c) => ({ id: c.id, was: b.get(c.id).text, now: c.text })),
  };
}
