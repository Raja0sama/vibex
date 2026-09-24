// Which anchor hash applies to a file. No I/O and no crypto, so the validator
// can warn about a mode without pulling in the hashing.

// Whitespace-insensitive by construction. Anything not listed is hashed exact:
// an unknown format costs a spurious "stale", never a false "verified".
const LOOSE_EXT = new Set([
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'json',
  'java', 'kt', 'kts', 'scala', 'groovy', 'go', 'rs', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp',
  'cs', 'swift', 'dart', 'php', 'sql', 'graphql', 'gql', 'prisma', 'proto', 'css', 'scss', 'less',
]);

// Indentation is meaning. Only consulted to warn about an explicit loose override.
const SIGNIFICANT_EXT = new Set(['py', 'pyi', 'yaml', 'yml', 'mk', 'hs', 'lhs', 'nim', 'coffee', 'pug', 'jade', 'sass', 'fs', 'fsi', 'fsx']);
const SIGNIFICANT_NAME = new Set(['makefile', 'gnumakefile']);

function extOf(p) {
  const base = String(p || '').split(/[\\/]/).pop().toLowerCase();
  const dot = base.lastIndexOf('.');
  return { base, ext: dot > 0 ? base.slice(dot + 1) : '' };
}

export function isWhitespaceSignificant(p) {
  const { base, ext } = extOf(p);
  return SIGNIFICANT_NAME.has(base) || SIGNIFICANT_EXT.has(ext);
}

// `hash_mode` on the source overrides the extension.
export function hashModeFor(source) {
  if (source?.hash_mode === 'exact' || source?.hash_mode === 'loose') return source.hash_mode;
  return LOOSE_EXT.has(extOf(source?.path).ext) ? 'loose' : 'exact';
}
