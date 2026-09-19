// Git as a source of "what actually changed".
//
// Every command runs through an injected `run(args) -> string | null`, so this
// module executes nothing itself and can be tested against a scripted repo.
// `null` from `run` means the command failed, which is always treated as "we do
// not know" rather than "nothing changed" — guessing the optimistic answer here
// would silently skip checks.

export function head(run) {
  const sha = run(['rev-parse', 'HEAD']);
  return sha ? sha.trim() : null;
}

// Paths modified, staged, or untracked right now. These are invisible to a
// commit-to-commit diff, so they must always be re-read.
export function dirtyPaths(run) {
  const out = run(['status', '--porcelain', '--untracked-files=all']);
  if (out === null) return null;
  const paths = new Set();
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const body = line.slice(3);
    // "R  old -> new" reports both sides; both matter to an anchor.
    const arrow = body.indexOf(' -> ');
    if (arrow === -1) paths.add(body.trim());
    else { paths.add(body.slice(0, arrow).trim()); paths.add(body.slice(arrow + 4).trim()); }
  }
  return paths;
}

export function changedSince(run, from, to = 'HEAD') {
  if (!from) return null;
  const out = run(['diff', '--name-only', `${from}`, to]);
  if (out === null) return null; // unknown commit, shallow clone, rewritten history
  return new Set(out.split('\n').map((l) => l.trim()).filter(Boolean));
}

// git reports paths from the repository root; anchors resolve from --repo.
// When --repo is a subdirectory, the two only line up after this prefix is
// stripped, and a path outside it is not an anchor path at all.
export function prefix(run) {
  const out = run(['rev-parse', '--show-prefix']);
  return out === null ? null : out.trim();
}

export function underPrefix(paths, pre) {
  if (paths === null) return null;
  if (!pre) return paths;
  const out = new Set();
  for (const p of paths) if (p.startsWith(pre)) out.add(p.slice(pre.length));
  return out;
}

export function shortSha(sha) {
  return typeof sha === 'string' && sha.length >= 7 ? sha.slice(0, 7) : sha || null;
}
