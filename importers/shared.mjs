export function slug(value, fallback = 'item') {
  const s = String(value ?? '')
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  const out = /^[a-zA-Z]/.test(s) ? s : `${fallback}-${s}`;
  return out.replace(/-+$/, '') || fallback;
}

export function uniqueId(base, taken) {
  let id = base; let n = 2;
  while (taken.has(id)) { id = `${base}-${n}`; n += 1; }
  taken.add(id);
  return id;
}

export function firstSentence(text, max = 120) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  const m = /^(.*?[.!?])(\s|$)/.exec(s);
  const out = m ? m[1] : s;
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}
