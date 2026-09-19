---
name: vibex
description: Generate ERD (entity-relationship), C4 (context/container/component), API endpoint catalogue, and lifecycle/state-machine diagrams as a validated JSON spec plus a standalone interactive HTML viewer. Imports OpenAPI, GraphQL SDL, and Prisma schemas directly; when no spec file exists, reads the code (NestJS controllers/resolvers, TypeORM/Prisma entities) and authors the JSON by hand. Use when the user asks for a database diagram, ERD, data model, table relationships, C4 diagram, system context, container or component diagram, API map, endpoint list, route overview, GraphQL operation overview, "show me the endpoints", status flow, state machine, lifecycle, allowed transitions, or "what happens after X is approved".
license: MIT
metadata:
  version: "0.1.0"
  cli: node bin/vibex.mjs
  repository: https://github.com/Raja0sama/vibex
---

# vibeX

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
demo [dir]        render examples/ into dir (+ dashboard.html)
types             list types with schema and example paths
```

YAML OpenAPI needs the optional `yaml` package: run `npm install` inside the skill root once (installed automatically on the `npx vibex` path), or convert the file to JSON.

## Viewer

Click a node for details (columns, fields, params, sources, relationships). `/` searches, `Esc` clears, `t` toggles theme, `0` fits, `+`/`-` zoom. `#node=<id>` in the URL deep-links to a node. SVG and PNG export buttons produce standalone files in the current theme.
