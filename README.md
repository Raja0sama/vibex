# vibeX

JSON spec in, standalone interactive HTML out. Four diagram types:

| Type | What it draws | Import from |
|---|---|---|
| `erd` | tables with columns, PK/FK badges, crow's-foot cardinality, groups | Prisma schema, GraphQL SDL (`--erd`) |
| `c4` | persons, systems, containers, components, databases, queues, nested boundaries, labeled arrows | hand-authored |
| `endpoints` | REST / GraphQL / event catalogue grouped by resource, method badges, auth, status codes, types | OpenAPI 2/3, GraphQL SDL |
| `lifecycle` | state machine: initial/waiting/terminal/failure states, transitions with actor, event, guard, action | hand-authored |

No required dependencies. Node 18+. The optional `yaml` package is only needed for YAML OpenAPI files (`npm install` once in the skill root, or it comes along with `npx @raja0sama/vibex`).

## Quick start

Runs on a fresh clone:

```bash
node bin/vibex.mjs demo out                                  # renders examples/ -> out/*.html + out/dashboard.html
node bin/vibex.mjs validate examples/orders.erd.json
node bin/vibex.mjs render   examples/orders.erd.json out/orders.erd.html --open
node bin/vibex.mjs import graphql test/fixtures/shop.graphql out/shop.endpoints.json
node bin/vibex.mjs dashboard out/index.html out --title "My system"   # every spec in one page
npm test
```

On your own project:

1. `import prisma prisma/schema.prisma docs/arch/db.erd.json` (or author JSON from `schemas/`)
2. `render docs/arch/db.erd.json --open`
3. `dashboard docs/arch/index.html docs/arch --title "My system"`

Source links: set `meta.repository: {"url": "https://github.com/org/repo", "revision": "main"}` (web root, no `.git`) and `sources: [{"path": "src/x.ts", "line": 42}]` on a node; the viewer links to `<url>/blob/<revision>/<path>#L<line>`. Dashboard URLs carry deep links (`#d=2&node=list-orders`) that update as you click.

## Layout

```
bin/vibex.mjs            CLI: validate, render, import, dashboard, demo, types
schemas/                 JSON Schema per type (the authoring contract)
examples/                one example spec per type
renderers/<type>/        JSON -> SVG body
renderers/shared/        validate, layout (grid, orthogonal routing), svg styles, template injection, dashboard
importers/               openapi, graphql (own SDL parser), prisma
assets/template.html     single-diagram shell; slots are <!-- VIBEX:* --> comments
assets/dashboard.html    multi-diagram shell: sidebar, overview, cross-links
assets/viewer.js|css     shared viewer runtime, inlined into both shells
test/                    node:test suite + fixtures
SKILL.md                 agent instructions (Claude Code / Cursor skill)
```

The viewer finds nodes and edges purely through `data-node-id` and `data-edge-from/to` attributes, and reads the embedded spec JSON for the details panel. A new diagram type is a schema, a validator function, a renderer that emits those attributes, and a line in `renderers/shared/render.mjs`.

## Install

As a Claude Code / Cursor skill (folder with SKILL.md at the root):

```bash
npx skills add Raja0sama/vibex          # or: git clone and
ln -s "$(pwd)" ~/.claude/skills/vibex
node ~/.claude/skills/vibex/bin/vibex.mjs types
```

From npm (optional):

```bash
npx @raja0sama/vibex demo out           # package is scoped; the bin it exposes is vibex
npm i -g @raja0sama/vibex && vibex types
```

Note: the unscoped `vibex` name on npm belongs to an unrelated package. Always install `@raja0sama/vibex`.

## Publish

For the owner, once. Confirm the copyright holder in `LICENSE` first.

```bash
cd /path/to/vibex
git init -b main
git add -A
git check-ignore assets/dashboard.html         # must print nothing (exit 1)
git commit -m "vibeX 0.1.0"
gh repo create Raja0sama/vibex --private --source=. --push
git tag v0.1.0 && git push --tags

npm pack --dry-run                             # check assets/dashboard.html and LICENSE are listed
npm publish --access public                    # runs prepublishOnly = npm test
```

Release procedure for later versions: see the checklist at the bottom of `CHANGELOG.md`.

## License

MIT, see `LICENSE`. Inspired by [tt-a1i/archify](https://github.com/tt-a1i/archify) (MIT): same JSON-IR -> deterministic SVG -> self-contained viewer idea. Ideas only; no code was reused.
