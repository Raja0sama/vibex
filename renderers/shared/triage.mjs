// Reads an intake issue and decides whether it can be acted on.
//
// The useful output is not "yes" — it is a precise "no": which claim does not
// exist, which spec was never named. An agent that guesses produces a confident
// wrong pull request, which costs a reviewer more than an unanswered issue.

export const ACTIONS = { act: 'act', ask: 'ask', ignore: 'ignore' };

const KNOWN_INTENTS = new Set(['doc-request', 'doc-problem', 'spec-gap', 'proposal']);
const BLOCK = /```vibex\s*\n([\s\S]*?)```/;

// The context block is written by the page, but an issue body is public input:
// anyone can type a fenced block. Treat it as a hint to verify, never a fact.
export function parseIntake(body) {
  const text = String(body || '');
  const context = {};
  const m = BLOCK.exec(text);
  if (m) {
    for (const line of m[1].split('\n')) {
      const kv = /^\s*([a-z_]{1,24})\s*:\s*(.{1,200})\s*$/i.exec(line);
      if (kv) context[kv[1].toLowerCase()] = kv[2].trim();
    }
  }
  const prose = text.replace(BLOCK, '').replace(/^\s*---\s*$/gm, '')
    .replace(/Context, filled in automatically[^\n]*/g, '').trim();
  const intent = KNOWN_INTENTS.has(context.intent) ? context.intent : null;
  return { intent, context, prose, hadBlock: Boolean(m) };
}

const ask = (reason, question) => ({ action: ACTIONS.ask, reason, reply: question });

// `graph` and `specIds` come from the build, so every reference is checked
// against what actually exists rather than taken on trust.
export function triage(parsed, { graph = null, specIds = new Set(), labels = [] } = {}) {
  const { intent, context, prose } = parsed;

  if (!intent && !labels.includes('intake')) {
    return { action: ACTIONS.ignore, reason: 'not an intake issue' };
  }
  if (!intent) {
    return ask('no intent', 'I could not tell what kind of request this is. Could you file it from one of the issue forms, or say whether you want something documented, something corrected, or something proposed?');
  }
  if (prose.replace(/\s+/g, ' ').length < 15) {
    return ask('no prose', 'There is not enough here for me to act on. Could you say, in a sentence, what you were trying to find out or what looks wrong?');
  }

  if (intent === 'doc-problem') {
    const id = context.claim;
    if (!id) {
      return ask('no claim', 'Which sentence is wrong? Quoting it, or filing this from the claim itself in the docs, tells me exactly what to re-check.');
    }
    const claim = graph?.claims?.find((c) => c.id === id);
    if (graph && !claim) {
      return ask('unknown claim', `I cannot find a claim called \`${id}\` in the current build — it may have been renamed or superseded since this page was generated. Could you point me at the sentence as it reads now?`);
    }
    return { action: ACTIONS.act, reason: 'claim resolved', target: { kind: 'claim', id, subject: claim?.subject, confidence: claim?.confidence } };
  }

  if (intent === 'spec-gap') {
    const ref = context.spec;
    const specId = ref ? String(ref).split('#')[0] : null;
    if (!ref && !/\.(ts|js|go|java|py|rb|sql|prisma|graphql)\b/.test(prose)) {
      return ask('no target', 'Which diagram should this be in, and where does it live in the code? A file path is usually enough for me to take it from there.');
    }
    if (specId && specIds.size && !specIds.has(specId)) {
      return ask('unknown spec', `I cannot find a spec called \`${specId}\`. Which diagram did you mean?`);
    }
    return { action: ACTIONS.act, reason: 'target resolved', target: { kind: 'spec', ref: ref || null, node: ref ? String(ref).split('#')[1] || null : null } };
  }

  if (intent === 'proposal') {
    // A proposal with no stated problem is a sketch, and drawing it would give
    // it more standing than it has earned.
    if (!/\b(because|so that|so we|problem|why|avoid|reduce|prevent|cost)\b/i.test(prose)) {
      return ask('no rationale', 'What problem would this solve? A proposal gets drawn and argued about, so the reason it exists matters more than the shape.');
    }
    return { action: ACTIONS.act, reason: 'proposal stated', target: { kind: 'proposal' } };
  }

  return { action: ACTIONS.act, reason: 'question stated', target: { kind: 'document' } };
}

// What the agent is allowed to do for each intent. Nothing here merges.
export const PLAYBOOK = {
  'doc-request': 'Author a new `*.docs.json`, or add a section to an existing one. Anchor what the code proves; ask before asserting anything in someone else’s name. Open a pull request.',
  'doc-problem': 'Re-read the code the claim points at. Still true → re-anchor. No longer true → rewrite it, or supersede it and say why. Open a pull request.',
  'spec-gap': 'Read the code, add the missing thing to the spec, re-render, and check that no claim about it went stale. Open a pull request.',
  proposal: 'Author specs with `meta.proposed: true` and `meta.proposal` pointing back at this issue. Every claim is asserted, never anchored — there is no code. Put what the proposer has not worked out in `coverage.out_of_scope`. Open a pull request.',
};
