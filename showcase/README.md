# Relay — the public showcase

A fictional parcel delivery network, documented the way vibeX is meant to be used.
This is what [the demo](https://raja0sama.github.io/vibex/demo/dashboard.html) is
built from, on every deploy.

It is deliberately a different domain from `examples/` — those are small and
didactic, for the skill to read as a pattern. This is a whole system, and it
exists to show the breadth: every spec type, both importers, and the same
renderer producing genuinely different shapes.

| File | What it shows |
|---|---|
| `relay-context.c4.json` | **C4 level 1** — the system in its world, one box, four external dependencies |
| `relay.c4.json` | **C4 level 2** — 16 containers, nested boundaries, drill-down links |
| `dispatch.c4.json` | **C4 level 3** — inside one service, with its externals drawn greyed |
| `relay.erd.json` | 13 tables and enums across three bounded contexts, hand-authored |
| `billing.erd.json` | **a second data model, imported** from `prisma/schema.prisma` |
| `relay.endpoints.json` | 17 REST operations across four audiences, plus published events |
| `portal.endpoints.json` | **GraphQL, imported** from `graphql/portal.graphql` — queries, mutations, a subscription |
| `parcel.lifecycle.json` | 12 states left-to-right, with retry loops and a recoverable failure |
| `invoice.lifecycle.json` | 6 states **top-to-bottom** — the same renderer, a very different shape |
| `relay.docs.json` | the system document — 153 claims, six stated gaps |
| `tracking.docs.json` | one topic in depth — 27 claims, four stated gaps |
| `changelog.json` | a fictional v2.4.0 release, with what it did to the documentation |
| `src/`, `dispatch/` | the code every anchored claim points at |

Nothing here runs. It is the shape of a system, not a working one, and it ships
with the repository rather than the npm package.

```bash
# the two importers, re-run to prove they still produce these files
node bin/vibex.mjs import prisma  showcase/prisma/schema.prisma   showcase/billing.erd.json  --title "Billing data model"
node bin/vibex.mjs import graphql showcase/graphql/portal.graphql showcase/portal.endpoints.json --title "Merchant portal API"

# the whole site
npm run build:site
```

The two imported files carry hand-written `meta.subtitle`, `meta.id` and
`meta.repository` on top of what the importer produced — which is the normal
workflow: import gets you a draft, you edit it like a human would.
