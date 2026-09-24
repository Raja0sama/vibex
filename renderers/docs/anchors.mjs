// Anchor hashing: pins a written claim to the code it describes.
//
// Reformatting a file does not change what it does, so it must not flag every
// claim about it; changing a line does change what it does, so it must. Where
// indentation is syntax — Python, YAML, Makefiles — reindenting IS changing a
// line, so the hash may only forgive whitespace in languages known not to care.
import { createHash } from 'node:crypto';
import { hashModeFor } from './hash-mode.mjs';

export { hashModeFor, isWhitespaceSignificant } from './hash-mode.mjs';

// `line` alone selects that one line, `line`+`end_line` the inclusive range,
// neither the whole file.
export function selectRegion(text, line, endLine) {
  const lines = String(text).split(/\r?\n/);
  if (!Number.isInteger(line)) return lines;
  const from = Math.max(1, Math.min(line, lines.length));
  const to = Number.isInteger(endLine) ? Math.max(from, Math.min(endLine, lines.length)) : from;
  return lines.slice(from - 1, to);
}

// loose: every whitespace run collapsed to one space, each line trimmed.
// exact: leading indentation kept; only trailing whitespace, line endings and
// trailing blank lines are forgiven.
export function normalizeRegion(text, line, endLine, mode = 'loose') {
  const lines = selectRegion(text, line, endLine);
  if (mode === 'loose') return lines.map((l) => l.replace(/\s+/g, ' ').trim()).join('\n');
  const kept = lines.map((l) => l.replace(/\s+$/, ''));
  while (kept.length && kept[kept.length - 1] === '') kept.pop();
  return kept.join('\n');
}

export function hashRegion(text, line, endLine, mode = 'loose') {
  return createHash('sha256').update(normalizeRegion(text, line, endLine, mode), 'utf8').digest('hex').slice(0, 12);
}

// readFile returns the file's text, or null when it does not exist. Kept as an
// argument so this module never touches the filesystem and stays testable.
export function checkAnchor(source, readFile) {
  const text = readFile(source.path);
  if (text === null || text === undefined) {
    return { state: 'missing', detail: `${source.path} does not exist` };
  }
  if (source.symbol && !text.includes(source.symbol)) {
    return { state: 'missing', detail: `${source.symbol} is no longer in ${source.path}` };
  }
  const actual = hashRegion(text, source.line, source.end_line, hashModeFor(source));
  if (actual === source.hash) return { state: 'match', detail: '', hash: actual };
  return { state: 'changed', detail: `${source.path} changed since the claim was last confirmed`, hash: actual };
}
