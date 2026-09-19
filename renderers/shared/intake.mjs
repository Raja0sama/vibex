// Turns "I noticed something while reading this" into a filed issue that an
// agent can act on without guessing.
//
// The value is not the link, it is the context. A person clicking from a claim
// already knows which claim, which document, which node and which commit —
// making them retype that is how you get issues nobody can action. So the body
// carries a fenced block of exactly that, alongside the prose for the human.
//
// Nothing here talks to an API. It builds a URL that opens a prefilled form,
// which the person still has to read and submit.

export const INTENTS = {
  'doc-request': { label: 'Request a document', labels: ['docs', 'intake'], lead: 'Please document:' },
  'doc-problem': { label: 'Report a problem', labels: ['docs', 'intake'], lead: 'What is wrong:' },
  'spec-gap': { label: 'Something is missing', labels: ['spec', 'intake'], lead: 'What is missing:' },
  proposal: { label: 'Propose a change', labels: ['proposal', 'intake'], lead: 'What if:' },
};

// GitHub and GitLab spell the query differently. Anything else gets no link at
// all rather than one that opens a 404.
export function issueEndpoint(url) {
  if (typeof url !== 'string') return null;
  const clean = url.replace(/\/+$/, '').replace(/\.git$/, '');
  if (/^https?:\/\/(www\.)?github\.com\//i.test(clean)) return { base: `${clean}/issues/new`, host: 'github' };
  if (/^https?:\/\/(www\.)?gitlab\.com\//i.test(clean)) return { base: `${clean}/-/issues/new`, host: 'gitlab' };
  return null;
}

// A body long enough to break the URL helps nobody; browsers and servers both
// give up somewhere past 8k.
const MAX_BODY = 4000;

export function contextBlock(context = {}) {
  const order = ['intent', 'document', 'claim', 'confidence', 'spec', 'node', 'commit', 'built'];
  const rows = order
    .filter((k) => context[k] !== undefined && context[k] !== null && context[k] !== '')
    .map((k) => `${k}: ${context[k]}`);
  if (!rows.length) return '';
  // Fenced and labelled so the agent reads it and the human's eye skips it.
  return ['```vibex', ...rows, '```'].join('\n');
}

export function issueUrl({ repository, intent, title, note, context = {} }) {
  const endpoint = issueEndpoint(repository?.url);
  if (!endpoint) return null;
  const spec = INTENTS[intent] || INTENTS['doc-problem'];

  const body = [
    `${spec.lead}\n\n`,
    note ? `${note}\n\n` : '',
    '---\n\n',
    'Context, filled in automatically. Leave it in — it is how this gets picked up.\n\n',
    contextBlock({ intent, ...context }),
  ].join('').slice(0, MAX_BODY);

  const q = new URLSearchParams();
  if (endpoint.host === 'gitlab') {
    q.set('issue[title]', title);
    q.set('issue[description]', body);
  } else {
    q.set('title', title);
    q.set('body', body);
    q.set('labels', spec.labels.join(','));
  }
  return `${endpoint.base}?${q.toString()}`;
}
