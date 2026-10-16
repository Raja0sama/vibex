// Steps nest (a fragment holds steps, an alt holds branches of steps), but
// everything that numbers, indexes or cross-links messages needs them flat
// and in reading order. One walk, shared, so step 4 is step 4 everywhere.

export function isMessage(step) { return Boolean(step) && typeof step === 'object' && 'from' in step && 'to' in step; }
export function isNote(step) { return Boolean(step) && typeof step === 'object' && 'note' in step; }
export function isFragment(step) { return Boolean(step) && typeof step === 'object' && 'fragment' in step; }

export function branchesOf(fragment) {
  return [{ label: fragment.label, steps: fragment.steps }, ...(Array.isArray(fragment.else) ? fragment.else : [])];
}

export function messagesOf(steps) {
  const out = [];
  const walk = (list) => {
    for (const step of Array.isArray(list) ? list : []) {
      if (isMessage(step)) out.push(step);
      else if (isFragment(step)) for (const b of branchesOf(step)) walk(b?.steps);
    }
  };
  walk(steps);
  return out;
}

export function messageId(m, index) {
  return m.id || `${m.from}-${m.to}-${index}`;
}
