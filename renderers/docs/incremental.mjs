// Decides which anchors actually need re-reading.
//
// A full check re-hashes every anchored file on every build. Git already knows
// which files moved, so most builds can reuse the previous result — but only
// where reuse is provably safe. Every uncertainty resolves toward re-checking:
// a stale "verified" is the one output this feature cannot afford.

export const LOCK_ARTIFACT = 'docs-lock';

export function emptyLock() {
  return { schema_version: 1, artifact: LOCK_ARTIFACT, commit: null, checked_at: null, claims: {} };
}

function anchored(claims) {
  return (claims || []).filter((c) => c?.source?.kind === 'anchored');
}

/**
 * @returns {{recheck: Set<string>, reuse: Map<string, object>, reason: string}}
 */
export function planCheck({ claims, lock, commit, changed, dirty }) {
  const all = anchored(claims);
  const recheck = new Set();
  const reuse = new Map();

  const everything = (reason) => ({ recheck: new Set(all.map((c) => c.id)), reuse: new Map(), reason });

  if (!lock || lock.artifact !== LOCK_ARTIFACT) return everything('no previous check to build on');
  if (!commit) return everything('not a git repository, or HEAD is unreadable');
  if (!lock.commit) return everything('the previous check did not record a commit');
  if (changed === null) return everything(`cannot diff ${lock.commit.slice(0, 7)}..HEAD, so nothing can be reused`);
  if (dirty === null) return everything('cannot read the working tree state');

  const touched = new Set([...changed, ...dirty]);
  for (const c of all) {
    const prev = lock.claims?.[c.id];
    if (!prev) { recheck.add(c.id); continue; }
    // The spec itself may have been re-anchored or rewritten since the lock.
    if (prev.hash !== c.source.hash) { recheck.add(c.id); continue; }
    if (touched.has(c.source.path)) { recheck.add(c.id); continue; }
    // A claim that did not verify last time is re-checked until it does, so a
    // problem cannot go quiet just because nobody touched the file.
    if (prev.state !== 'match') { recheck.add(c.id); continue; }
    reuse.set(c.id, { state: prev.state, detail: prev.detail || '', hash: prev.hash, commit: prev.commit || lock.commit });
  }

  const skipped = reuse.size;
  return {
    recheck,
    reuse,
    reason: skipped
      ? `${skipped} of ${all.length} anchors unchanged since ${lock.commit.slice(0, 7)}`
      : `nothing reusable since ${lock.commit.slice(0, 7)}`,
  };
}

// Fold this run's results back into a lock for the next build.
export function mergeLock({ claims, lock, statuses, commit, now = Date.now() }) {
  const next = emptyLock();
  next.commit = commit || null;
  next.checked_at = new Date(now).toISOString();
  for (const c of anchored(claims)) {
    const st = statuses.get(c.id);
    if (!st) continue;
    const prev = lock?.claims?.[c.id];
    next.claims[c.id] = {
      state: st.state,
      hash: c.source.hash,
      // The commit a claim last verified at is provenance in time: it survives
      // builds where the claim was reused rather than re-read.
      commit: st.state === 'match' ? (st.commit || commit || null) : (prev?.commit ?? null),
      ...(st.detail ? { detail: st.detail } : {}),
    };
  }
  return next;
}

// The commit each claim last verified at, for the graph to show.
export function verifiedCommits(lock) {
  const out = new Map();
  for (const [id, row] of Object.entries(lock?.claims || {})) {
    if (row.state === 'match' && row.commit) out.set(id, row.commit);
  }
  return out;
}
