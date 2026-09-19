<div align="center">

<img src="assets/favicon.svg" width="72" height="72" alt="">

# vibeX

### Your architecture diagram is a lie.

vibeX reads the thing that can't lie — your Prisma schema, your OpenAPI document,
your GraphQL SDL, or the source itself — and renders the diagram that's actually true.

**One standalone HTML file. No server. Nothing leaves your network.**

[![ci](https://github.com/Raja0sama/vibex/actions/workflows/ci.yml/badge.svg)](https://github.com/Raja0sama/vibex/actions/workflows/ci.yml)
![node](https://img.shields.io/badge/node-%E2%89%A518-2b6cb0)
![deps](https://img.shields.io/badge/dependencies-0-2f855a)
![license](https://img.shields.io/badge/license-MIT-718096)

</div>

---

## The diagram you have right now

- ~~a whiteboard photo in a Slack thread~~
- ~~a Confluence page last touched in 2023~~
- ~~a Miro board nobody can find~~
- ~~a Mermaid block that stopped rendering~~
- ~~the one guy who knows~~

→ **one command, run against the schema that actually ships.**

```bash
npx @raja0sama/vibex demo out && open out/dashboard.html
```

<!-- TODO: replace with a real screen recording of the viewer once the demo gallery is up -->

## Why "vibeX"

**vibe** — how code gets written now. Fast, AI-assisted, more of it than anyone
can hold in their head.

**X** — the crossings. Which table joins which. Which service calls which.
What happens after approval.

> **You vibed it into existence. vibeX shows you what you actually built.**

The mark is the same idea: two edges crossing. Everything interesting in a system
is a line between two things, not the things themselves.

## Four views. One source of truth.

| | Type | What it draws | Import from |
|---|---|---|---|
| 🔵 | `erd` | tables, columns, PK/FK badges, crow's-foot cardinality that knows nullable from not, bounded contexts as groups | Prisma, GraphQL SDL (`--erd`) |
| 🟣 | `c4` | persons, systems, containers, components, databases, queues, nested boundaries, labeled arrows that name the protocol | hand-authored |
| 🟢 | `endpoints` | REST routes, GraphQL operations, published events — grouped by resource, with method badges, auth, params, status codes | OpenAPI 2/3, GraphQL SDL |
| 🟡 | `lifecycle` | every state an order can reach and every legal move between them, with actor, event, guard and side effect on each arrow | hand-authored |

Each one is a validated JSON spec plus a rendered viewer. **The spec is the artifact you keep; the HTML is disposable.**

## Three commands. No config file.

```bash
# 1. import — your schema becomes a draft spec
vibex import prisma  prisma/schema.prisma  docs/db.erd.json
vibex import openapi openapi.yaml          docs/api.endpoints.json
vibex import graphql schema.graphql        docs/api.endpoints.json

# 2. validate — dangling refs and unreachable states are errors that name the field
vibex validate docs/db.erd.json

# 3. render — one file, CSS and JS inlined, spec embedded
vibex render docs/db.erd.json --open

# bonus: every spec in the folder, one page, cross-linked
vibex dashboard docs/index.html docs --title "Payments platform"
```

No source schema? It reads the code — NestJS controllers, GraphQL resolvers,
TypeORM entities, Express routers, SQL migrations — and writes the spec itself.

## Prose that can't quietly go stale

> **An AI wrote the sentence once. Arithmetic checks it forever.**

A diagram can't drift from the schema, because it's generated from it. Prose can, and
always does. So `vibex docs` documents a system the same way it draws one — the unit
isn't a page, it's a **claim**: one sentence with a source attached.

| Source | What holds it up |
|---|---|
| `derived` | Computed from a diagram spec by one of ten fixed generators. Cannot disagree with the diagram beside it, because it *is* the diagram. |
| `anchored` | Prose pinned to a file and a symbol by a content hash. Whitespace-insensitive — reformat the file and nothing moves; change the line and the claim flags itself. |
| `asserted` | A person's decision, with their name and the date. For what no file can prove — and it expires, so "we decided this in March" can't pass for fact forever. |

**Confidence is computed, never written.** A claim cannot declare how trustworthy it is.
The build assigns one of five states from the evidence and the clock, and the validator
rejects any claim that tries to rate itself:

`verified` · `stated` · `needs re-reading` · `out of date` · `unverifiable`

**There is no model in the verification path** — only `fs`, `path`, `crypto` and `git`.
That is the whole point, and it is why a full drift check costs ~70ms and nothing per run.

```bash
vibex docs system.docs.json specs/ --repo . --check      # exit 1 on any claim that no longer holds
vibex docs system.docs.json specs/ --repo . --reanchor   # re-pin hashes after a deliberate edit
vibex docs system.docs.json specs/ --repo . --md doc.md  # portable Markdown, zero raw HTML
```

`--check` makes documentation drift fail a pull request like a broken test. Anchor
checking is incremental and keyed on git: `docs.lock.json` records the commit each claim
last verified at, so a rebuild re-reads only what git says moved — and every uncertainty
resolves toward reading *more*, never less. (CI passes `--no-lock`: a lock file arrives
from a contributor's machine asserting that claims were verified, and CI re-reads every
anchor rather than taking that on trust.)

**It tells you what it doesn't cover.** Every document renders three lists: what was
read, what is deliberately out of scope and why, and what the build noticed but could
not account for. A document that implies completeness gets believed exactly where it
is wrong.

**One artefact, two readers.** People read the dashboard panel; agents read `docs.json` —
every fact once, addressable, with resolved edges, so "what breaks if I change this" is a
single lookup rather than a search. Narrative sections carry Markdown that cites claims
inline with `[[claim-id]]`, and each citation renders as a coloured pip showing that
claim's confidence, so a reader sees which words are load-bearing.

**One document per question.** `auth.docs.json`, `payments.docs.json` — each becomes its
own dashboard entry. Not one document trying to be the whole system.

```bash
vibex dashboard docs/index.html docs --title "Payments platform" --repo .
```

Pass `--repo` or every anchored claim renders as unverifiable.

### What it does not do

It catches drift, not initial error. If the first draft misreads the code, the hash
still matches, CI stays green, and a wrong claim can stay verified indefinitely.
Reviewing the spec once, at authoring time, is the only thing that establishes truth.

The honest version: **you get a reviewable first draft in one pass, and after you have
read it once, arithmetic keeps it honest.**

## Or skip the flags and just ask

vibeX installs as a Claude Code / Cursor skill. The whole CLI collapses into a sentence:

```
> show me the data model
  wrote db.erd.json · db.erd.html

> now the endpoints
  wrote api.endpoints.json · api.endpoints.html

> what happens after a request is approved?
  wrote request.lifecycle.json · request.lifecycle.html
```

```bash
npx skills add Raja0sama/vibex     # or: git clone && ln -s "$(pwd)" ~/.claude/skills/vibex
node ~/.claude/skills/vibex/bin/vibex.mjs types
```

## The security review is one sentence long

An architecture diagram is a reconnaissance map of your system — table names, service
topology, auth boundaries, every internal route. It's the exact thing you can't paste
into someone else's SaaS.

So vibeX doesn't have a server. **There is nothing to review, because there is nowhere for it to go.**

What the generated file does **not** do, verified in the source:

- No `fetch`, `XMLHttpRequest` or WebSocket anywhere in the viewer runtime
- No CDN, no web fonts, no analytics, no telemetry — system font stack and nothing else
- PNG export renders through an in-memory blob; it never touches the network
- Pull the cable out of the wall and it still pans, zooms, searches and exports

Put it on S3 behind SSO, internal nginx, a private Pages site, a Confluence attachment,
committed next to the code, or `file://`. **No account to view it. No seats. No expiry.**
Hand it to a contractor, an auditor, or the new hire on their first morning. It's a file.

## A viewer, not a picture

A PNG of a 40-table schema is a wall. This one you can interrogate:

<kbd>/</kbd> search · <kbd>t</kbd> theme · <kbd>0</kbd> fit · <kbd>+</kbd>/<kbd>-</kbd> zoom · <kbd>Esc</kbd> clear

Click any node for its columns, fields, params and relationships. `#node=<id>` deep-links
to one specific table in one specific diagram — so you can send someone *the thing*, not
"it's in the doc somewhere." SVG and PNG export produce standalone files in the current theme.

Set `meta.repository` and `sources: [{path, line}]` and every node links back to the exact
line on GitHub or GitLab.

## Layout

```
bin/vibex.mjs            CLI: validate, render, import, dashboard, demo, types
schemas/                 JSON Schema per type (the authoring contract)
examples/                one example spec per type
renderers/<type>/        JSON -> SVG body
renderers/shared/        validate, layout (grid, orthogonal routing), svg styles, template, dashboard
importers/               openapi, graphql (own SDL parser), prisma
assets/template.html     single-diagram shell; slots are <!-- VIBEX:* --> comments
assets/dashboard.html    multi-diagram shell: sidebar, overview, cross-links
assets/viewer.js|css     shared viewer runtime, inlined into both shells
assets/icon.svg          the mark (monochrome, currentColor) · favicon.svg is the tile version
test/                    node:test suite + fixtures
SKILL.md                 agent instructions (Claude Code / Cursor skill)
```

A new diagram type is a schema, a validator function, a renderer that emits
`data-node-id` / `data-edge-from|to`, and a line in `renderers/shared/render.mjs`.

## Install

```bash
npx @raja0sama/vibex demo out           # the package is scoped
npm i -g @raja0sama/vibex && vibex types
```

> The unscoped `vibex` on npm is an unrelated package. Always install `@raja0sama/vibex`.

Node 18+. Zero required dependencies. The optional `yaml` package is only needed
if your OpenAPI document is YAML rather than JSON.

## On the roadmap

A GitHub Action that runs in **your** CI, regenerates the diagrams on every pull request,
and comments what moved — *"2 tables, 3 endpoints."* Still no server. Still nothing
leaving your network.

## License

MIT, see [LICENSE](LICENSE).

<div align="center">

**Never stale. Never leaves.**

</div>
