---
name: vibex
description: Generate ERD (entity-relationship), C4 (context/container/component), API endpoint catalogue, and lifecycle/state-machine diagrams as a validated JSON spec plus a standalone interactive HTML viewer. Imports OpenAPI, GraphQL SDL, and Prisma schemas directly; when no spec file exists, reads the code (NestJS controllers/resolvers, TypeORM/Prisma entities) and authors the JSON by hand. Use when the user asks for a database diagram, ERD, data model, table relationships, C4 diagram, system context, container or component diagram, API map, endpoint list, route overview, GraphQL operation overview, "show me the endpoints", status flow, state machine, lifecycle, allowed transitions, or "what happens after X is approved". Also writes the system's documentation as a checkable fact graph — every statement carries its source and a computed confidence, and a drift check fails CI when the code moves underneath it. Use when the user asks to document a system, write architecture docs, produce an onboarding or handover document, explain how a system works, or build context other agents can read.
license: MIT
metadata:
  version: "0.5.0"
  cli: node bin/vibex.mjs
  repository: https://github.com/Raja0sama/vibex
---

# vibeX

*You vibed it into existence. vibeX shows you what you actually built.*

Output is always two files: `<name>.<type>.json` (the spec, the source of truth) and `<name>.<type>.html` (self-contained viewer: pan/zoom, search, click-for-details, dark/light, SVG/PNG export). Not fancy. Correct and readable.

Skill root: the directory containing this file. Every command below is `node <skill-root>/bin/vibex.mjs …`.

## Steps

1. **Pick the type** from the ask. One diagram per type per question; do not mix.

   | Ask | Type | Spec file |
   |---|---|---|
   | tables, models, schema, relations, FKs, data model | `erd` | `schemas/erd.schema.json` |
   | context, containers, components, who talks to what, system boundary | `c4` | `schemas/c4.schema.json` |
   | endpoints, routes, API surface, GraphQL operations, events/topics | `endpoints` | `schemas/endpoints.schema.json` |
   | statuses, state machine, lifecycle, what happens after X, allowed transitions | `lifecycle` | `schemas/lifecycle.schema.json` |

2. **Find a machine-readable source first.** Search the repo before reading code:
   - `endpoints`: `openapi.*`, `swagger.*`, `*.graphql`, `schema.gql`, or a generated schema endpoint dump. Run `import openapi` or `import graphql`.
   - `erd`: `schema.prisma` → `import prisma`. A GraphQL SDL can also seed an ERD with `import graphql <file> out.json --erd`.
   - `c4`: never importable. Author it (step 3).

   ```bash
   node bin/vibex.mjs import openapi  path/to/openapi.yaml  out/api.endpoints.json
   node bin/vibex.mjs import graphql  path/to/schema.graphql out/api.endpoints.json
   node bin/vibex.mjs import prisma   prisma/schema.prisma   out/db.erd.json
   ```

   After an import, open the JSON and edit it like a human would: rename groups, drop noise endpoints (health, metrics), add `entities` links on endpoints, add `sources`. The import is a starting point, not the deliverable.

3. **No source file? Dig in the code.** Read the schema file for your type once, then read one example in `examples/`. Author the JSON fresh. Where to look:
   - **NestJS REST**: `@Controller('prefix')` + `@Get/@Post/@Put/@Patch/@Delete('path')` → one endpoint each, path = prefix + path with `:id` rewritten as `{id}`. `@UseGuards(...)`/`@Roles(...)` → `auth`. `@Body()` DTO class → `request`. Return type / `@ApiOkResponse` → `response`. One group per controller. Put `sources: [{path, line}]` on every endpoint pointing at the handler method. Prepend `app.setGlobalPrefix()` and `@Version()`/`VersioningType.URI` segments to every path. `@Param()` → `params[].in: "path"`, `@Query()` → `"query"`, `@Headers()` → `"header"`; a DTO class in `@Query()` becomes one param per property.
   - **NestJS GraphQL**: `@Query()`, `@Mutation()`, `@Subscription()` in `*.resolver.ts` → method QUERY/MUTATION/SUBSCRIPTION, path = `name(arg: Type)`. `@ObjectType`/`@InputType` classes → `types`.
   - **Express/Fastify**: `router.get('/x', …)`, `app.post(...)`, `fastify.route({method, url})`.
   - **TypeORM**: `@Entity('table')` classes; `@PrimaryGeneratedColumn`/`@PrimaryColumn` → `pk`; `@Column({nullable, unique, type})`; `@ManyToOne` + `@JoinColumn` → FK on this side, relationship `from` this entity `to` target with `from_cardinality: many`; `@OneToOne` → `one`/`zero-or-one`; `@ManyToMany` + `@JoinTable` → a join entity or a many↔many relationship.
   - **Prisma**: prefer the importer. The importer already fills `sources` (path + model line); add `description` and `groups` by hand. It names entities by the lowercased model name (`OrderItem` → `orderitem`; `@@map` only changes the label).
   - **SQL migrations**: `CREATE TABLE`, `REFERENCES`, `PRIMARY KEY`, `UNIQUE`.
   - **C4**: `docker-compose.yml`, `k8s/`, `serverless.yml`, `infra/` for containers and datastores; `package.json`/`*.module.ts` for tech; HTTP clients, queue clients, SDK imports (`stripe`, `@aws-sdk/client-sqs`, `nodemailer`) for external systems and relationships. People come from auth roles.

   Keep IDs stable and boring: `user`, `order_item`, `bff`, `list-orders`. Reuse the same ID for the same thing across diagrams so ERD entity IDs can go into `endpoints[].entities`. With a Prisma-imported ERD, use exactly the importer's ids (`orderitem`, not `order_item`); run `dashboard` and check the "which endpoints touch which tables" table is non-empty.

4. **Validate, then render.**

   ```bash
   node bin/vibex.mjs validate out/db.erd.json
   node bin/vibex.mjs render   out/db.erd.json out/db.erd.html
   ```

   Exit 1 means errors: fix the named field and rerun. Warnings never block; fix the ones about layout (`row`/`col` hints) when they appear, ignore missing-summary warnings unless the user wants prose. Add `--open` to the render to open the browser.

5. **Several diagrams for one system? Build the dashboard too.** Keep all specs in one folder (e.g. `docs/arch/`), then:

   ```bash
   node bin/vibex.mjs dashboard docs/arch/index.html docs/arch --title "My system"
   ```

   The overview page lists every diagram, shows which endpoints touch which tables (from `endpoints[].entities`), and resolves C4 `link` values that name another spec file in the folder (`link: "bff.c4.html"` → the `bff.c4.json` panel; both specs must be in the same `dashboard` invocation, matching is by file name). Re-run it after every spec change; it is cheap.

6. **Report**: the two paths, counts (entities/elements/endpoints and relationships), what was imported vs inferred, and anything you left out on purpose. If code reading left ambiguity (cardinality, auth), say so in one line and put it in a `cards` note with `tone: "warning"`.

## Documentation (`docs`)

A `docs` spec is not a diagram. Its unit is a **claim**: one checkable sentence with a source. The build turns claims plus the diagram specs into `docs.json` — the fact graph humans read in the dashboard and agents read directly.

```bash
node bin/vibex.mjs docs docs/arch/system.docs.json docs/arch --repo . --reanchor   # pin anchors
node bin/vibex.mjs docs docs/arch/system.docs.json docs/arch --repo . --check      # exit 1 on drift
node bin/vibex.mjs docs docs/arch/system.docs.json docs/arch --repo . --md DOCS.md # a file for the repo
```

Commit `docs.lock.json` next to the spec. It records the commit each anchor last verified at, so a rebuild only re-reads the files git says have moved — and so a claim can say *when* it was last true, not just that the build ran. Delete it to force a full check.

Read `schemas/docs.schema.json` once, then `examples/shop.docs.json` (a system overview) and `examples/auth.docs.json` (one topic, in depth). Build the diagrams first: a docs spec documents specs that already exist.

Put the docs spec in the same folder as the diagrams and it becomes a Documentation panel in the dashboard, first in the sidebar:

```bash
node bin/vibex.mjs dashboard docs/arch/index.html docs/arch --title "My system" --repo .
```

Pass `--repo` or every anchored claim renders as unverifiable.

### One document per question

Write a separate `*.docs.json` per topic — `auth.docs.json`, `payments.docs.json`, `onboarding.docs.json` — not one document trying to be the whole system. Every docs spec in the folder becomes its own entry under Documentation in the dashboard.

A topic document answers one question a person actually asks. It `covers` whatever specs it needs to point at, generates little or nothing, and earns its keep through prose and anchored claims. Undocumented nodes in a spec are only reported as gaps when the document derives facts from that spec, so a focused document is not nagged about the forty things it was never about.

Keep one system overview alongside them: it generates the structural facts (elements, entities, operations) and stays shallow. Do not restate a topic document's claims in it.

### When the user tells you how something works

This is the main way a good document gets written, and the path the hard rules below are built around.

1. **Find it in the code first.** They said sessions expire after twelve hours — go find the constant. If you find it, that is an `anchored` claim and their word became a pointer, not the evidence.
2. **What you cannot find, ask about, then attribute.** "There are no refresh tokens" may be a decision with no artefact. That is an `asserted` claim with *their* name and today's date, and their reasoning in `source.rationale`.
3. **Write the prose around it.** Their explanation is the narrative; the claims are what makes it checkable. Cite each load-bearing sentence.
4. **Say what they did not tell you.** Whatever the conversation left open goes in `coverage.out_of_scope` with `"Not documented yet"` and what specifically is unknown. This is the most valuable part of a document written from a conversation, because it is the part nobody remembers to write.

### Where a fact belongs

Ask in this order and stop at the first yes.

1. **Can a generator derive it?** Then never write it. Add the generator to a section and the build computes the sentence from the spec, so it can never disagree with the diagram. Available: `erd.entities`, `erd.relationships`, `c4.elements`, `c4.relationships`, `c4.boundaries`, `endpoints.operations`, `endpoints.types`, `lifecycle.states`, `lifecycle.transitions`, `coverage`. Column counts, keys, cardinalities, delete rules, who-calls-what, transitions, guards, operation lists — **all derived. Writing them by hand is the most common way to make this feature worthless.**
2. **Does a specific piece of code prove it?** Write it `anchored`, pointing at that file and symbol. This is where most real documentation lives: invariants, ownership of a write path, what a guard actually enforces.
3. **Is it a decision only a person can confirm?** Write it `asserted` — and see the hard rule below.
4. **None of the above?** Leave it out and put the gap in `coverage.out_of_scope` with a reason.

### Writing the prose

A document nobody reads top to bottom is a database with headings. Give each section a `narrative`: Markdown that a person reads straight through, citing claims with `[[claim-id]]`.

```json
"narrative": "There is exactly one way in. The BFF is the only container reachable from the public internet [[network.public-entry]], and nothing behind it accepts outside connections [[network.private-isolated]]."
```

- **Every load-bearing sentence carries a citation.** The citation renders as a coloured pip showing that claim's confidence, so a reader sees which words are backed and which are connective tissue. Prose with no citations is an opinion piece inside a document whose point is traceability — the validator warns when a long narrative cites nothing.
- **Write the connective tissue, not the facts.** Counts, keys, cardinalities and routes come from generators. Narrative says what they *mean*: what the shape implies, what breaks if it changes, what a newcomer would get wrong.
- Cited claims render as collapsible evidence under the prose, so the section reads as a document and proves itself on demand.
- Markdown supported: headings, paragraphs, lists, blockquotes, fenced code, tables, rules, inline bold/italic/code/link. Raw HTML is escaped, never rendered.

### Hard rules

- **Never invent an `asserted` claim.** `source.by` names a human who stands behind it, and `source.at` is the date they confirmed it. You may only write one when the user told you the fact in this conversation, or it is signed in a file you can cite (an ADR, a CODEOWNERS entry, a README with an author). Otherwise anchor it or omit it. An asserted claim you made up is a human's name on your guess — it is the one failure this whole design exists to prevent.
- **Never write `confidence`.** The validator rejects it. You declare evidence; the build computes trust.
- **One claim = one assertion.** If the sentence needs `, and` or a semicolon, it is two claims. The validator warns; split rather than rephrase around it. Separate claims can be cited, checked and retracted on their own — a compound one cannot.
- **Never compute a `hash` yourself.** Write `"hash": "000000000000"` and run `--reanchor`. Anchor the smallest region that proves the claim: a method, not a file. A whole-file anchor goes stale on every unrelated edit and trains the reader to ignore the warning.
- **State what is true, in the present tense.** No `should`, `probably`, `might`, `will be`, `TODO` — those are not claims about the system. No instructions to the reader. Reasons go in `source.rationale`, not in `text`.
- **Every claim gets a `subject`** (`shop.c4#bff`, `orders.erd#order`) unless it is about the whole system. That is what puts it on the node's page and what lets an agent ask "what is known about X". Subjects that do not resolve are reported in `coverage.unknown` — fix them, do not leave them.
- **`coverage.out_of_scope` is mandatory in practice.** Name every area a reader might expect and not find, with a reason. `"Not documented yet"` is a valid reason; silence is not. A document that implies completeness gets believed exactly where it is wrong.

### Getting it reviewed

CI proves a claim's evidence has not moved. It cannot prove the claim was ever true — that was your reading of the code at authoring time. **The review is the only moment initial truth is established**, and after it passes, arithmetic will defend a wrong claim just as faithfully as a right one.

So hand over a review list, do not just hand over a document. In your report, name:

- every `asserted` claim and whose name is on it
- every anchor covering a whole file rather than a symbol
- anything you inferred rather than read directly

Tell the reviewer to work in this order, which catches the most per minute:

1. **`coverage.out_of_scope`, before any claim.** A thin or generic gap list means the document is silently incomplete, which is more dangerous than any single wrong sentence — and it calibrates how far to trust the rest. "Future work" is not a gap; "whether the domain APIs authenticate each other is unknown" is.
2. **Every `asserted` claim, one by one.** These carry a person's name and nothing checks them. Did that person actually say it? Is the date the day they confirmed it, not the day it was typed? This is where fabrication is easiest and most damaging.
3. **A sample of anchors, opened at the line.** Does the code say what the claim says? Is the anchor tight — a method rather than a file? A whole-file anchor is legitimate for a small single-purpose file and a smell for anything else, because it goes stale on edits that have nothing to do with the claim.
4. **Narrative sentences with no citation near them.** Those are the unverified glue between claims, and the easiest place for an unsupported assertion to ride along.
5. **Not the derived claims.** They are mechanical and cannot disagree with the spec. Review the *generator choice* instead: did the section ask for the right ones, and is anything structural missing because no generator was requested?

Push back on: an `asserted` claim whose `by` is a team, a role, or a model rather than a person; a claim that reads as two facts; a gap list that names nothing specific.

### Letting readers file what they notice

Set `meta.repository` and the rendered pages grow a way to report things: a quiet flag on every claim, one on every node's details panel, and three buttons in the docs toolbar for requests that are not about a single claim.

Each opens a prefilled issue whose body carries a fenced block an agent can read:

```vibex
intent: doc-problem
document: relay.docs
claim: session.ttl
confidence: verified
spec: relay.c4#bff
commit: 42d3ee6c27fdc16a1933a96ec9e2d7293161d251
```

Nothing is sent anywhere — the link opens a form the person still has to submit. When you pick one of these issues up, read that block first: it tells you exactly which claim, which node and which tree the reader was looking at, which is usually more precise than the prose above it. If the block is missing or the prose is too vague to act on, reply asking rather than guessing.

### Proposals: documenting something that does not exist

When the user asks what a change *would* look like, set `meta.proposed: true` and `meta.proposal` (who, when, which issue, one sentence of why) on every spec you write for it.

A proposal renders with a banner, a purple badge, a stamp burned into the SVG so an exported image still says what it is, and its claims read `proposed` rather than `verified`. `--check` ignores it — there is nothing for it to drift from.

Two rules the validator enforces, because breaking either would make a proposal indistinguishable from the system:

- **A proposal may not contain an anchored claim.** There is no code to anchor to. Everything is asserted, in the proposer's name.
- **Say where it came from.** `meta.proposal` without `meta.proposed` renders as though it describes something real, and is warned about.

Put what the proposer has *not* worked out in `coverage.out_of_scope`. On a proposal that section is the most valuable one — it is the difference between a design and a daydream.

### Picking up an intake issue

Issues labelled `intake` come from someone reading a diagram or a document. Read the fenced `vibex` block first: it names the claim, spec or node they were looking at and the commit they saw. That is usually more precise than the prose above it.

`.github/workflows/intake.yml` triages before you see it, and refuses to guess — an unresolvable claim id or an unnamed diagram gets a question, not a pull request. If you pick one up by hand, hold the same line: **reply asking rather than produce a confident wrong change.**

Whatever you do, open a pull request and let the drift check run on it. Nothing here merges on its own.

### Wiring it into CI

Add this once, in the project being documented. It is the step that makes the rest binding rather than advisory — without it a stale claim is a warning nobody reads.

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }      # a shallow clone cannot diff against the lock's commit
- run: npx @vibex/vibex docs docs/arch/system.docs.json docs/arch --repo . --check --no-lock
```

`--no-lock` on purpose: the lock file is an optimisation for local iteration, and it reaches CI from a contributor's machine asserting that claims were verified. CI re-reads every anchor from scratch rather than taking that on trust. A full check of ~60 claims runs in well under a second, with no dependencies, no network and no model — so there is no reason to skip it.

### When `--check` reports drift

- `stale` — the anchored code changed. **Re-read the code and decide**: still true → `--reanchor`; no longer true → rewrite the claim, or delete it and add a replacement with `supersedes` pointing at the old id. Never `--reanchor` without reading; it silently re-certifies a claim that may now be false.
- `broken` — the file or symbol is gone, or `--repo` was not given. Re-anchor to where the code moved, or drop the claim.
- `expired` — nobody has confirmed the assertion inside `review_window_days`. Ask the user; do not refresh the date yourself.

A claim that did not verify is re-read on every build until it does, so a problem cannot go quiet just because nobody touched the file again.

### Publishing it as Markdown

`--md` writes the document as a Markdown file containing no raw HTML, so it survives a paste into Confluence, a wiki, or a README unchanged. Every claim appears with its confidence marker and source; the panel can hide evidence behind a disclosure, a file that travels cannot.

```bash
node bin/vibex.mjs docs docs/arch/auth.docs.json docs/arch --repo . --md docs/AUTH.md
```

Regenerate and re-paste rather than editing the Markdown: it is an output, and an edit there is lost on the next build and invisible to `--check`. If the user maintains docs in Confluence, the spec and its lock file are what lives in the repository and gets reviewed; the Confluence page is a copy that is republished, the same way the HTML is.

### Report

Give the counts line verbatim (`N claims — X verified, …`), every `coverage.unknown` entry, and which claims you anchored versus which the user asserted. If you left something undocumented, say so — it should already be in `out_of_scope`. When the document came out of a conversation, list what you attributed to them by name, so they can correct it before it hardens into documentation.

## Release notes (`changelog`)

```bash
node bin/vibex.mjs changelog v1.2.0..main --specs docs/arch --md RELEASE.md -o changelog.json
```

Reads the commits in a range and writes two things: a JSON artefact to keep in the repository, and Markdown with no raw HTML so it survives a paste into release notes or a wiki.

- **`--specs <dir>` is what makes it worth running here.** It builds the fact graph at both ends of the range and reports what the release did to the documentation: claims written, reworded, superseded, removed. Derived facts are counted, never listed.
- **Sections are a guess unless the project uses conventional commits.** When they are, the artefact and the Markdown both say so. Do not present an inferred grouping as the author's intent.
- A commit is only `internal` when *every* path it touched was.

Write `changelog.json` next to the specs and `vibex dashboard` picks it up as a Changes panel, where each entry's specs are chips that open the diagram they touched:

```bash
node bin/vibex.mjs changelog v1.2.0..main --specs docs/arch -o docs/arch/changelog.json
node bin/vibex.mjs dashboard docs/arch/index.html docs/arch --repo .
```

Report the counts line as it prints, and if claims were **removed**, say so out loud — a claim that vanished took whatever it documented with it, and that is worth a human checking.

## Authoring rules

- Under ~25 entities, ~15 C4 elements, ~80 endpoints per diagram. Past that, split by ERD `groups`, C4 level, or endpoint group, and link with `link` (C4) or a card.
- ERD: `from` is the FK/child side, `to` is the referenced/parent side. Default `many → one`. Set `to_cardinality: zero-or-one` when the FK column is nullable. Unique FK → `from_cardinality: one` or `zero-or-one`. Use `groups` to frame bounded contexts; the renderer lays each group out as its own block.
- C4: every element except persons gets a one-sentence `description`. Every relationship gets a verb `label`; add `technology` when it is not obvious. `external: true` for anything the team does not own. One `meta.level` per diagram; drill down with `link` to another rendered HTML.
- Lifecycle: one `subject` per diagram (`Order.status`, not the whole system). State ids = the enum values in code. Exactly one `kind: initial`; every state either reaches a `terminal` or is explicitly `failure`. Each transition names `event` and `actor`; put conditions in `guard` (no brackets) and side effects in `action`. `kind: auto|timeout` for system-driven moves, `failure` for error paths. Find them in code: status enums, `switch (status)` / state-machine tables, guards like `assertTransition(from, to)`, service methods that set `status =`.
- Endpoints: REST paths use `{param}`. GraphQL `path` is the signature `name(arg: Type!)`. Use `EVENT` for topics, queues, webhooks the service publishes. Put ERD entity IDs in `entities` so the reader can jump from an endpoint to the tables it touches. Do not paste full descriptions into `summary`; one line.
- `meta.repository: {"url": "https://github.com/org/repo", "revision": "main"}` (web root, no `.git`) plus `sources: [{"path": "src/orders/orders.controller.ts", "line": 42}]` makes the viewer link to `<url>/blob/<revision>/<path>#L<line>`. Works for GitHub and GitLab; omit `revision` to link HEAD. Fill them whenever the diagram came from code.
- Layout is automatic. Only set `row`/`col` when a layout warning asks for it or the user complains.
- Do not hand-edit the generated HTML. Change the JSON and re-render.

## Commands

```
validate <spec.json> [--json]
render   <spec.json> [out.html] [--open] [--json]
import openapi <file.json|yaml> [out.json] [--title T] [--all-types]
import graphql <schema.graphql>  [out.json] [--title T] [--erd]
import prisma  <schema.prisma>   [out.json] [--title T]
dashboard <out.html> <spec.json|dir>... [--title T] [--subtitle S] [--open] [--json]
                  one HTML: sidebar of all diagrams, overview tiles, entity↔endpoint cross-links
docs <docs.json> <spec.json|dir>... [-o docs.json] [--md doc.md] [--repo dir]
     [--check] [--reanchor] [--lock docs.lock.json] [--no-lock] [--json]
                  fact graph: derived facts + authored claims, each with provenance
                  and a computed confidence. --check exits 1 on stale/broken/expired.
                  --md also writes the document as Markdown. Re-reads only the anchors
                  git says moved since the commit in the lock file.
demo [dir]        render examples/ into dir (+ dashboard.html)
outdated [dir]    which generated files this version would now render differently.
                  Exits 1 if any is stale, so CI can gate on it.
types             list types with schema and example paths
```

**Never answer from a generated file without checking it first.** Run
`vibex outdated <dir>`. If it reports anything stale, regenerate from the spec and
read the new file — a stale artifact and a broken feature look identical to
whoever opens one, and reasoning from the wrong one wastes everybody's time.

Regenerate; never hand-edit generated HTML to bring it up to date. The file is
derived from the spec the same way a binary is derived from source, and a
hand-patched artifact is one no version of this tool would ever have produced.
If the *spec* is what is wrong, fix the spec and re-render.

YAML OpenAPI needs the optional `yaml` package: run `npm install` inside the skill root once (already present if the skill came from a global `npm i -g @vibex/vibex`), or convert the file to JSON.

## Viewer

Click a node for details (columns, fields, params, sources, relationships). `/` searches, `Esc` clears, `t` toggles theme, `0` fits, `+`/`-` zoom. `#node=<id>` in the URL deep-links to a node. SVG and PNG export buttons produce standalone files in the current theme.
