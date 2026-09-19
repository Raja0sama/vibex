#!/usr/bin/env node
// Reads an intake issue, decides whether it can be acted on, and writes the
// answer to GITHUB_OUTPUT. It never edits a spec and never opens a pull
// request — it only decides, so that the decision is testable on its own.
import fs from 'node:fs';
import path from 'node:path';
import { parseIntake, triage, PLAYBOOK, ACTIONS } from '../../renderers/shared/triage.mjs';
import { buildGraph, specId } from '../../renderers/docs/graph.mjs';
import { validateSpec, DIAGRAM_TYPES } from '../../renderers/shared/validate.mjs';

const dir = process.argv[2] || 'showcase';
const body = process.env.ISSUE_BODY || '';
const labels = (process.env.ISSUE_LABELS || '').split(',').map((l) => l.trim()).filter(Boolean);

// Build the current picture so every reference in the issue is checked against
// what exists now, not what existed when the page was rendered.
const specs = new Map();
const docsSpecs = [];
for (const file of fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : []) {
  let spec;
  try { spec = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); } catch { continue; }
  if (!spec?.diagram_type || !validateSpec(spec).ok) continue;
  const id = specId(spec, file.replace(/\.json$/, ''));
  if (spec.diagram_type === 'docs') docsSpecs.push(spec); else specs.set(id, spec);
}
const graph = docsSpecs.length
  ? { claims: docsSpecs.flatMap((d) => buildGraph(d, { specs }).claims) }
  : null;

const parsed = parseIntake(body);
const result = triage(parsed, { graph, specIds: new Set(specs.keys()), labels });

const reply = result.action === ACTIONS.ask
  ? result.reply
  : result.action === ACTIONS.act
    ? `Picking this up.\n\n**What I will do:** ${PLAYBOOK[parsed.intent]}\n\nI will open a pull request. A person reviews it before anything merges — nothing here changes the docs on its own.`
    : '';

const out = {
  action: result.action,
  intent: parsed.intent || '',
  reason: result.reason,
  target: JSON.stringify(result.target || {}),
  reply,
  playbook: PLAYBOOK[parsed.intent] || '',
};
const sink = process.env.GITHUB_OUTPUT;
for (const [k, v] of Object.entries(out)) {
  const line = `${k}<<__VIBEX__\n${v}\n__VIBEX__\n`;
  if (sink) fs.appendFileSync(sink, line); else process.stdout.write(line);
}
