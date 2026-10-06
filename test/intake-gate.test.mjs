import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BODY = 'Please save this layout\n\n```vibex\nintent: layout\nspec: order.lifecycle\n```\n\n```json\n{"vibex_layout":1,"spec":"order.lifecycle","positions":{"paid":[1,2]}}\n```';
const triage = (association) => spawnSync(process.execPath, ['.github/scripts/triage-issue.mjs', 'examples'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, GITHUB_OUTPUT: '', ISSUE_BODY: BODY, ISSUE_LABELS: 'intake', ISSUE_AUTHOR_ASSOCIATION: association },
}).stdout;

test('intake: issue text from outside the project never reaches the agent', () => {
  const wf = fs.readFileSync(path.join(root, '.github/workflows/intake.yml'), 'utf8');
  assert.match(wf, /contains\(fromJSON\('\["OWNER", "MEMBER", "COLLABORATOR"\]'\), github\.event\.issue\.author_association\)/);
  assert.match(triage('NONE'), /a maintainer will pick it up/);
  assert.doesNotMatch(triage('NONE'), /I will open a pull request/);
  assert.match(triage('OWNER'), /I will open a pull request/);
});

test('workflows: every action is pinned to a commit', () => {
  for (const f of fs.readdirSync(path.join(root, '.github/workflows'))) {
    for (const [, ref] of fs.readFileSync(path.join(root, '.github/workflows', f), 'utf8').matchAll(/uses: \S+@(\S+)/g)) {
      assert.match(ref, /^[0-9a-f]{40}$/, `${f}: ${ref} is a tag, not a commit`);
    }
  }
});
