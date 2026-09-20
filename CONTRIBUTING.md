# Contributing

## The one rule

A claim in a document either points at code that proves it, or it is marked as
asserted and carries whose word it is on. Nothing else ships. A tool whose pitch is
documentation you can trust cannot itself contain a sentence nobody checked.

If you cannot establish something from the code, put it in `coverage.out_of_scope`
rather than asserting it in somebody's name.

## Before you open a pull request

```bash
npm test                                  # the suite, no network, no fixtures to install
node bin/vibex.mjs demo out               # must print no warnings
node bin/vibex.mjs validate <spec…>       # any spec you touched
```

Then the drift check, which is what CI actually gates on:

```bash
node bin/vibex.mjs docs examples/auth.docs.json examples \
  --repo examples/shop-repo --check --no-lock -o /dev/null
```

If a claim has gone stale, do not re-anchor it blindly. Read the code it points at.
Still true, re-anchor with `--reanchor`. No longer true, rewrite the claim or
supersede it and say why. Re-anchoring a claim you have not read converts a true
sentence into a false one with a fresh hash on it.

## House style

- **Zero runtime dependencies.** `yaml` is optional and only for YAML OpenAPI. A
  pull request that adds a dependency needs to argue for it in the description.
- **Escape everything on the way into HTML or SVG.** `esc()` from
  `renderers/shared/utils.mjs`, every time, no exceptions for "this one is ours".
- **Comments say why, not what.** The code already says what.
- **Node 18+, ES modules, no build step.** What you read is what runs.
- Tests live in `test/vibex.test.mjs` and use `node --test`. A bug fix comes with
  the test that would have caught it.

## Releasing

Maintainers only, and the procedure is in [CHANGELOG.md](CHANGELOG.md#release-checklist).
Publishing happens in CI on a tag; nothing is published from a laptop.
