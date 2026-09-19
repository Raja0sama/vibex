// Derived facts: plain-English sentences computed from a diagram spec.
//
// Nothing here is authored. Each generator reads one spec and returns claims
// whose text is a mechanical rendering of what the spec already says, so a
// sentence cannot disagree with the diagram beside it.
//
// One rule runs through all of it: never inflect a fragment the author wrote.
// A guard reading "fewer than three attempts" cannot be bent into a clause
// without guessing, and a generator that guesses produces confident nonsense.
// Author fragments are introduced with a label and printed verbatim.

const A = (w) => (/^[aeiou]/i.test(w || '') ? 'an' : 'a');
const list = (xs) => (xs.length < 2 ? (xs[0] || '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const stop = (s) => String(s).trim().replace(/\.?$/, '.');
const frag = (label, value) => (value ? ` ${label}: ${String(value).trim().replace(/\.$/, '')}.` : '');

// A claim id must survive re-runs unchanged, or citations break on every build.
const slug = (s) => String(s).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

function claim(specId, rule, key, text, subject) {
  return { id: `${specId}.${slug(key)}`, text, subject, source: { kind: 'derived', spec: specId, rule } };
}

// How many of the far side each near side gets.
const CARD = {
  one: 'exactly one',
  'zero-or-one': 'at most one',
  many: 'any number of',
  'one-or-many': 'one or more',
};

// Plural of "row" has to follow the cardinality, or the sentence reads wrong
// in exactly the half of cases nobody checks.
const rowWord = (card) => (card === 'one' || card === 'zero-or-one' ? 'row' : 'rows');

// on_delete is a database rule; spell out what it actually does to rows.
function onDelete(rule, parent, child) {
  switch (rule) {
    case 'cascade': return ` Deleting a ${parent} row deletes the ${child} rows that reference it.`;
    case 'restrict': return ` A ${parent} row cannot be deleted while ${child} rows reference it.`;
    case 'set-null': return ` Deleting a ${parent} row leaves the referencing ${child} rows with a null link.`;
    case 'no-action': return ` Deleting a ${parent} row is not propagated to ${child} rows.`;
    default: return '';
  }
}

export const GENERATORS = {
  'erd.entities'(spec, id) {
    return (spec.entities || []).map((e) => {
      const name = e.name || e.id;
      const kind = e.kind || 'table';
      const where = e.schema ? ` in schema ${e.schema}` : '';

      if (kind === 'enum') {
        const values = (e.values || []).map((v) => (typeof v === 'string' ? v : v.name));
        return claim(id, 'erd.entities', `entity.${e.id}`,
          `The ${name} enum${where} allows ${plural(values.length, 'value')}: ${list(values)}.`, `${id}#${e.id}`);
      }

      const cols = e.columns || [];
      const pk = cols.filter((c) => c.pk).map((c) => c.name);
      const key = pk.length === 1 ? ` and is keyed on ${pk[0]}`
        : pk.length > 1 ? ` and is keyed on the composite (${pk.join(', ')})`
          : ' and declares no primary key';
      const unique = cols.filter((c) => c.unique && !c.pk).map((c) => c.name);
      const nullable = cols.filter((c) => c.nullable).map((c) => c.name);

      let text = `The ${name} ${kind}${where} has ${plural(cols.length, 'column')}${key}.`;
      if (unique.length) text += ` ${list(unique)} ${unique.length === 1 ? 'is' : 'are'} unique.`;
      if (nullable.length) text += ` ${list(nullable)} may be null.`;
      return claim(id, 'erd.entities', `entity.${e.id}`, text, `${id}#${e.id}`);
    });
  },

  'erd.relationships'(spec, id) {
    const name = new Map((spec.entities || []).map((e) => [e.id, e.name || e.id]));
    const n = (x) => name.get(x) || x;
    return (spec.relationships || []).map((r, i) => {
      const from = n(r.from); const to = n(r.to);
      const toC = r.to_cardinality || 'one'; const fromC = r.from_cardinality || 'many';
      const via = r.from_column && r.to_column ? ` The link is ${from}.${r.from_column} → ${to}.${r.to_column}.` : '';
      const label = r.label ? ` The relationship is labelled "${r.label}".` : '';
      const text = `Each ${from} row relates to ${CARD[toC]} ${to} ${rowWord(toC)}. Each ${to} row relates to ${CARD[fromC]} ${from} ${rowWord(fromC)}.`
        + via + onDelete(r.on_delete, to, from) + label;
      return claim(id, 'erd.relationships', `rel.${r.id || `${r.from}-${r.to}-${i}`}`, text, `${id}#${r.from}`);
    });
  },

  'c4.elements'(spec, id) {
    return (spec.elements || []).map((e) => {
      const kind = e.kind || 'container';
      const tech = e.technology ? `, built with ${e.technology}` : '';
      const own = e.external ? ', owned outside this system' : '';
      const desc = e.description ? ` ${stop(e.description)}` : '';
      return claim(id, 'c4.elements', `element.${e.id}`,
        `${e.label} is ${A(kind)} ${kind}${tech}${own}.${desc}`, `${id}#${e.id}`);
    });
  },

  'c4.relationships'(spec, id) {
    const label = new Map((spec.elements || []).map((e) => [e.id, e.label || e.id]));
    const n = (x) => label.get(x) || x;
    return (spec.relationships || []).map((r, i) => {
      const over = r.technology ? ` over ${r.technology}` : '';
      const async = r.style === 'dashed' ? ' The call is asynchronous.' : '';
      const both = r.direction === 'both' ? ' Traffic flows both ways.' : '';
      // r.label is the author's verb phrase ("Places and reads orders"); keep
      // it whole rather than splicing it into a sentence it was not written for.
      const text = `${n(r.from)} connects to ${n(r.to)}${over}.${frag('Purpose', r.label)}${async}${both}`;
      return claim(id, 'c4.relationships', `rel.${r.id || `${r.from}-${r.to}-${i}`}`, text, `${id}#${r.from}`);
    });
  },

  'c4.boundaries'(spec, id) {
    const label = new Map((spec.elements || []).map((e) => [e.id, e.label || e.id]));
    const bLabel = new Map((spec.boundaries || []).map((b) => [b.id, b.label || b.id]));
    const n = (x) => label.get(x) || bLabel.get(x) || x;
    return (spec.boundaries || []).map((b) => claim(id, 'c4.boundaries', `boundary.${b.id}`,
      `The ${b.label} ${b.kind || 'system'} boundary contains ${list((b.contains || []).map(n))}.`,
      `${id}#${b.id}`));
  },

  'endpoints.operations'(spec, id) {
    return (spec.endpoints || []).map((e) => {
      const params = e.params || [];
      const required = params.filter((p) => p.required).map((p) => `${p.name} (${p.in || 'query'})`);
      // The summary is the author's sentence fragment; attach it, do not inflect it.
      let text = e.summary ? `${e.method} ${e.path} — ${stop(e.summary)}` : `${e.method} ${e.path} is an operation in this API.`;
      if (required.length) text += ` Required ${required.length === 1 ? 'parameter' : 'parameters'}: ${list(required)}.`;
      if (e.auth === false) text += ' It is callable without authentication.';
      if (e.request) text += ` It accepts ${e.request}.`;
      if (e.response) text += ` It returns ${e.response}.`;
      if (e.deprecated) text += ' It is deprecated.';
      return claim(id, 'endpoints.operations', `op.${e.id}`, text, `${id}#${e.id}`);
    });
  },

  'endpoints.types'(spec, id) {
    return (spec.types || []).map((t) => {
      const name = t.name || t.id;
      const kind = t.kind || 'object';
      if (kind === 'enum') {
        const values = (t.values || t.fields || []).map((v) => (typeof v === 'string' ? v : v.name));
        return claim(id, 'endpoints.types', `type.${t.id}`,
          `The ${name} enum allows ${plural(values.length, 'value')}: ${list(values)}.`, `${id}#${t.id}`);
      }
      const fields = t.fields || [];
      const required = fields.filter((f) => f.required || !f.nullable).map((f) => f.name);
      let text = `${name} is ${A(kind)} ${kind} type with ${plural(fields.length, 'field')}.`;
      if (required.length && required.length < fields.length) text += ` Always present: ${list(required)}.`;
      return claim(id, 'endpoints.types', `type.${t.id}`, text, `${id}#${t.id}`);
    });
  },

  'lifecycle.states'(spec, id) {
    const out = new Map();
    for (const t of spec.transitions || []) out.set(t.from, (out.get(t.from) || 0) + 1);
    // meta.subject names what carries the state, e.g. "Order.status".
    const thing = spec.meta?.subject ? String(spec.meta.subject).split('.')[0] : 'a new record';
    return (spec.states || []).map((s) => {
      const n = out.get(s.id) || 0;
      const role = {
        initial: `the state ${thing === 'a new record' ? thing : `a new ${thing}`} starts in`,
        waiting: 'a state that waits on something outside the system',
        terminal: 'a final state',
        failure: 'a failure state',
      }[s.kind] || 'a state';
      const exits = n === 0 ? ' Nothing leaves it.' : ` ${plural(n, 'transition')} lead${n === 1 ? 's' : ''} out of it.`;
      const desc = s.description ? ` ${stop(s.description)}` : '';
      return claim(id, 'lifecycle.states', `state.${s.id}`,
        `${s.label} is ${role}.${exits}${desc}${frag('Acts next', s.actor)}`, `${id}#${s.id}`);
    });
  },

  'lifecycle.transitions'(spec, id) {
    const label = new Map((spec.states || []).map((s) => [s.id, s.label || s.id]));
    const n = (x) => label.get(x) || x;
    return (spec.transitions || []).map((t, i) => {
      const trigger = t.event ? `on ${t.event}`
        : t.kind === 'timeout' ? 'on a timeout'
          : t.kind === 'auto' ? 'automatically'
            : 'with no recorded trigger';
      const text = `${n(t.from)} moves to ${n(t.to)} ${trigger}.`
        + frag('Triggered by', t.actor) + frag('Only when', t.guard) + frag('Side effect', t.action);
      return claim(id, 'lifecycle.transitions', `tr.${t.id || `${t.from}-${t.to}-${i}`}`, text, `${id}#${t.from}`);
    });
  },
};

// Which spec type each generator can answer. Asking for erd.entities against a
// C4 spec is a mistake worth reporting, not silently producing nothing.
export const GENERATOR_TYPE = Object.fromEntries(
  Object.keys(GENERATORS).map((g) => [g, g.split('.')[0]]),
);

export function runGenerator(name, spec, specId) {
  const fn = GENERATORS[name];
  if (!fn) return [];
  return fn(spec, specId).filter((c) => c.text && c.text.trim());
}
