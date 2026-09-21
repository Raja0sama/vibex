# Changelog

All notable changes to this project are recorded here. The format follows Keep a Changelog; versions follow SemVer.

## [Unreleased]

Nothing yet.

## [0.4.0] - 2026-09-21

C4 boxes are sized for the text they actually hold. Existing specs render at
different heights and edge labels that used to be cut now wrap, so this
changes what a generated file contains.

### Fixed
- **A C4 description longer than three lines was silently halved.** The cap is now measured by wrapping the wordiest description in the spec, bounded at five lines, and the whole rank grows to hold it.
  Greedy wrapping leaves ragged line ends, so dividing a description's length by the characters that fit comes up a line short — the wrap itself is the only honest count. One verbose element makes every box in the rank taller. That is the trade worth making: a long description costs height rather than quietly losing half of itself.
- **A dashboard could size a diagram's boxes from the previous diagram's text.** Sizing and drawing are two passes over the same spec, and the line cap they both read was module state. It travels as an argument now, so many renders in one process cannot interfere — the failure mode being boxes measured for three lines holding five.
- **Edge labels were truncated at 40 characters.** The label box was always sized from its own text, so nothing forced that cap; it just threw the rest away. Labels wrap to two lines instead.

### Added
- **A render says when text did not fit, and names what was cut.** The warning gives the element ids or the `from→to` of the relationships affected, and points at the tooltip and details panel where the full text is still readable.
  Silence is the failure mode this project exists to avoid. Whitespace is normalised on both sides before the comparison, so a description containing a newline no longer reports as shortened when every word of it survived.

## [0.3.1] - 2026-09-20

Install instructions only. No change to the CLI, the renderers, or anything a
generated file contains.

### Changed
- **The skill is the way in, everywhere.** README and landing page now lead with `cd ~ && npx skills add Raja0sama/vibex`, with the CLI presented as what the skill drives rather than as the thing you install first.
  `skills add` resolves relative to the directory you run it in, which is the failure people actually hit: run it in a project and the skill exists only there. That is now stated wherever the command appears. The npm global install stays as the pinned-release route, with a warning that under nvm `npm root -g` is scoped to the current Node version, so the symlink dies silently on an upgrade.
- The README claimed the repository was private and that `skills add` "does not work yet". It has been public since before 0.2.0 and the command works.

## [0.3.0] - 2026-09-20

Generated files can now say what built them, and every panel around the canvas
gets out of its way. Both change what a generated file contains, so this is a minor.

### Added
- **`vibex outdated <dir>` — which generated files this version would now render differently.** Every generated file records what produced it: `generator` for a person, and a build fingerprint for a machine. The fingerprint covers every renderer and every inlined asset, not just the version, so a fix that only touched `viewer.css` is as detectable as a release. It exits 1 when anything is stale, so CI can gate on it the way it gates on documentation drift.
  A stale artifact and a broken feature look identical to whoever opens the file; this is how you tell them apart. What it does not answer is whether the *spec* moved — a generated file carries its own spec, but renderers normalise before embedding, so a truthful answer there means re-rendering rather than diffing JSON.
- **Every panel around the canvas now collapses, and remembers it.** The dashboard index, the right-hand details panel and the notes strip each take a click or a key — `[`, `]` and `\` — and the choice is kept per panel across reloads.
  Collapsing is not hiding. The index keeps its colour dots and its active marker, and the details panel keeps `Details`, `Legend` and `Stats` readable down its edge; clicking one reopens the panel at that section. A reader who wants the diagram wide gets it without losing their way back.

## [0.2.1] - 2026-09-20

Documentation, README and landing page. No change to the CLI, the renderers, the
schemas, or anything a generated file contains.

### Changed
- The README leads with the skill rather than the CLI, and folds its reference material into collapsible sections.
- The demo is shown rather than promised: a linked thumbnail in the README, and an embedded player on the landing page.
- Attribution is now a `Prior art` section crediting the wider diagrams-as-code field — Mermaid, PlantUML, Structurizr, DBML, Graphviz and archify — instead of naming a single project.
- The landing page gained depth, and its nav no longer swallows the heading you jumped to.
- Article drafts are no longer tracked; `content/` is ignored.

## [0.2.0] - 2026-09-19

Four diagram types, documentation as a checkable fact graph, and a release list
built from git history.

### Changed
- Redesigned the generated viewer shell: icon toolbar with segmented zoom/export controls, dot-grid canvas, floating hint pill, sectioned side panel, scrollable detail tables that drop empty columns, tinted note cards, styled scrollbars, and a print stylesheet.
- Dashboard: brand mark, per-type colour dots in the sidebar, a totals strip on the overview, tiles that lift on hover, and a two-column stat grid on phones.
- Diagram boxes get a soft drop shadow; the theme button now shows the theme you are switching to.
- **C4 diagrams redesigned.** Databases and queues now have their own fills (teal, indigo) instead of sharing the container blue, so the legend swatches finally match the canvas; the swatches also echo each shape. Boxes hug their content and share one height per diagram, with the text block centred rather than top-aligned. Person elements read as a head over shoulders. Databases are proper cylinders with both caps. Boundaries get a tinted frame, a label tag that straddles the top edge, and a more solid frame the deeper they nest. `Drill down ↗` is an underlined footer instead of a corner note. Edge labels are slightly smaller and grow a dotted leader when obstacle avoidance pushes them off their own line.
- **C4 edge routing gets lanes.** Every edge crossing a gap used to turn at the same midpoint, so their turning segments — and the labels riding on them — stacked into one column. Edges sharing a gap are now spread across the gap by greedy interval colouring, which separates only the turns that actually overlap, so simple diagrams route exactly as before. Turns are clamped inside the gap so no lane runs over a box. `routeOrthogonal` takes an `offset.channel` and reports the `corridor` it used; `channelOffsets` assigns the lanes. ERD, endpoints and lifecycle still route down the middle.

### Fixed
- Lifecycle transitions crossing the same gap all turned at its midpoint, stacking their labels into one column. Lifecycle now uses the same lane assignment as C4 and ERD — every diagram type has it.
- When no free spot existed for a label, `placeLabel` took the first candidate that cleared the other labels, which could be one sitting across a node's title. It now measures the overlap and takes the least bad position, and searches further off the line before giving up. Across the eleven diagrams this repository ships, labels sitting on a node went from four to none — and a test now parses the rendered SVG and fails if that ever regresses.
- The Prisma importer wrote `1 enums` into the subtitle, which is the first line a reader sees of an imported diagram.
- The dashboard sorted C4 diagrams alphabetically, so a set of levels read component, context, container. Within C4 it now sorts by zoom — landscape, context, container, component — because that is the order a reader drills in.
- The demo's Changes panel was built from **vibeX's own commit history** and shown beside the Relay specs, so a fictional parcel network's release notes read "fix the clean-install gate". The changelog describes the repository being documented, not the tool doing the documenting; the showcase now carries a fixture describing a fictional Relay release, like the rest of it.
- The documentation-diff placeholder told the reader to pass `--specs`, which fires equally when `--specs` *was* passed and the range simply had no start commit to compare against. It now names the actual reason, and the CLI warns at the point the range is chosen.
- ERD relationships crossing the same gap all turned at its midpoint, stacking their cardinality labels into one column — the same defect fixed for C4, now using the same lane assignment.
- The clean-install CI gate ran `npm pack --pack-destination /tmp/pkg` without creating that directory. It passed locally, where the directory already existed, and failed on the first real runner.
- The example documentation anchored into `test/fixtures/`, which `npm pack` does not ship. A freshly installed package running `vibex demo` therefore opened on **22 unverifiable claims** — the worst possible first impression for a tool whose pitch is documentation you can trust. The fixture moved to `examples/shop-repo/` (it is an example, and it is the code the example documentation describes), and CI now installs the packed tarball and runs the demo, failing on any unverifiable claim rather than trusting a hand-maintained file list.
- Dashboard hash routing only ran on first load, so `#docs-1`, a pasted deep link, and browser back/forward did nothing on an already-open page. There is now one router, wired to `hashchange`.
- `renderSpec` threw a `TypeError` on any spec whose `diagram_type` has no diagram renderer. It now reports `not-a-diagram` and names what to run instead.
- Dashboard: every panel but the last rendered its boxes invisibly. The drop-shadow filter was referenced from the shared SVG stylesheet, and because CSS cascades across the whole document all four panels resolved to the last panel's namespaced filter id — a reference the other panels do not contain, which suppresses the element entirely. The filter now rides on the elements themselves, so each panel resolves its own copy.

### Added
- **The showcase now shows the breadth.** Nine diagrams instead of four: all three C4 levels with working drill-down, a second data model imported from a real `schema.prisma`, a GraphQL API imported from a real `.graphql` SDL, and a second lifecycle drawn top-to-bottom against the first one's left-to-right — the same renderer, a visibly different shape. Both importers run against files committed beside the output, so the demo proves they work rather than asserting it.
- **A Changes panel in the dashboard.** A `changelog.json` beside the specs becomes a panel, or pass `--changelog`. Each entry links to its commit in the repository the commits came from — not the one a spec happens to describe — and the specs it touched are chips that open those diagrams. Reworded claims are shown as the change they were, old wording struck through beside the new, which is the thing a file diff buries.
- **`vibex changelog`** builds a release list from commit history. With `--specs` it also reports what those commits did to the documentation — claims written, reworded, superseded and removed — which is the part a reader of a changelog cannot otherwise see. Derived facts are counted rather than named, because ninety machine-generated sentences appearing is not news. Conventional-commit prefixes are honoured where a project uses them; where it does not, sections are inferred from the files each commit touched and **the output says so**, because a reader who thinks the headings were chosen deliberately will draw conclusions from them. A commit that touches a renderer and a workflow is not internal: internal means every path was.
- **Proposals.** `meta.proposed` marks a spec as describing something that does not exist. It renders with a banner, a distinct badge, and a stamp drawn into the SVG so an exported image still says so; its claims read `proposed` rather than `verified`, and `--check` ignores it because there is nothing to drift from. The validator refuses an anchored claim inside one — there is no code to anchor to — and warns when a proposal carries no trail back to whoever made it. A document that merely *derives* facts from a proposed spec marks those facts proposed too.
- **Intake.** Four issue forms, a triage workflow, and a dispatcher that resolves an issue's `vibex` block against the current build. A claim id that no longer exists, a diagram nobody named, or a proposal with no stated problem gets a specific question posted back rather than a confident wrong pull request. The authoring step is gated on `ANTHROPIC_API_KEY`: without one the queue still triages and answers, it just writes nothing. Nothing merges — every path ends at a pull request with the drift check running on it.
- **Report it from where you noticed it.** Every claim, and every node's details panel, now carries a link that opens a prefilled issue on the project's own repository. The body holds a fenced `vibex` block with the claim id, the spec and node it is about, its confidence, and the exact commit the reader was looking at — so whoever picks the issue up, person or agent, does not have to reconstruct where the reader was standing. The docs toolbar adds the three intents that are not about one claim: request a document, report a gap, propose a change. GitHub and GitLab are understood; any other host gets no link rather than one that opens a 404, and a project with no `meta.repository` gets none at all.
- **A public showcase.** `showcase/` is a fictional parcel delivery network — 16 containers, 13 tables, 17 operations, a twelve-state parcel lifecycle with retry loops and a recoverable failure, and two documents totalling 129 claims with nine stated gaps. GitHub Pages now builds the demo from it rather than from the bundled examples: a different domain, at the depth the tool is actually for, while `examples/` stays small and didactic for the skill to read as a pattern. It ships with the repository, not the npm package, and the deploy fails if it ever publishes a claim it could not verify.
- `examples/order.lifecycle.json` replaces the previous lifecycle example and ties into `orders.erd.json`, so the bundled set is now one coherent system rather than a shop plus an unrelated flow.
- **`docs`: a fact graph for the system, for people and for agents.** A new spec type whose unit is a *claim* — one checkable sentence with a source — rather than a page of prose. Three kinds of source: `derived` (computed from a diagram spec by one of ten fixed generators, so the sentence cannot disagree with the diagram), `anchored` (prose pinned to a file and symbol by a content hash), and `asserted` (a person, with a date). A claim cannot declare its own confidence; the build computes one of `verified`, `stale`, `broken`, `asserted`, `expired` from the evidence and the clock, and the validator rejects any claim that tries. `vibex docs` emits `docs.json`: every fact once, a `subjects` index that gathers each node's claims and resolved edges, and a `coverage` block that names what the build could not account for. `--check` fails CI on anything stale, broken or expired; `--reanchor` re-pins hashes after a deliberate edit. Anchor hashes are whitespace-insensitive, so reformatting a file does not flag every claim about it while changing a line does.
- **A review flow in SKILL.md.** CI proves a claim's evidence has not moved; it cannot prove the claim was ever true. The skill now hands the reviewer a prioritised list — gaps first, then every asserted claim, then a sample of anchors, then uncited narrative — and tells the agent to name what it attributed to a person and what it inferred rather than read. Deliberately not a validator rule: whether a whole-file anchor is too loose depends on the file, and a warning that fires on legitimate cases is how people learn to ignore warnings.
- **CI gate for documentation drift.** A `docs-drift` job checks every `*.docs.json` and fails the build when a claim goes stale, broken or out of date, with a message that says to re-read the code rather than re-anchor blindly. It checks out full history and runs with `--no-lock`: the lock file arrives from a contributor's machine asserting claims were verified, and CI re-reads every anchor rather than trusting it. A second step fails the build if the Markdown export ever contains raw HTML, which would not render in Confluence or a wiki.
- **One document per topic.** Every `*.docs.json` in the set now gets its own entry under Documentation in the dashboard, so `auth.docs.json` and `payments.docs.json` stay separate documents instead of one trying to be the whole system. A new `examples/auth.docs.json` shows the shape: prose, seven claims, four things it says it does not cover. Undocumented nodes are reported as gaps only for specs the document actually derives facts from — a focused document is no longer nagged about the forty subjects it was never about.
- **`--md` output is now free of raw HTML**, so a document survives a paste into Confluence, a wiki or a README unchanged. Citations resolve to the cited claim's confidence mark inline rather than to in-page anchors, which do not survive the trip.
- **Narrative prose, so a docs page reads as a document.** A section can carry a `narrative` of Markdown that cites claims with `[[claim-id]]`. Each citation renders as a coloured pip carrying that claim's confidence, so a reader sees which words are load-bearing without leaving the sentence; the cited claims collapse into an evidence block beneath. The Markdown renderer is a deliberately small subset written for this purpose — agent-authored text is escaped first and formatting applied to the escaped text, so no input can emit a tag the renderer did not write, and `javascript:` links are dropped. A dangling citation fails the build; a long narrative citing nothing is warned about. `vibex docs --md` writes the whole document as a Markdown file, with every claim and its confidence marker.
- **Incremental anchor checking, keyed on git.** `vibex docs` writes `docs.lock.json` recording HEAD and the commit each anchor last verified at, then re-reads only the files git reports as changed since — committed diffs and uncommitted working-tree changes both. Every uncertainty resolves toward checking more: an unreadable HEAD, an undiffable commit, a re-anchored hash, or a claim that did not verify last time all force a re-read. The commit a claim verified at survives builds that reused the result, so the graph can say when a claim was last true rather than only when the build ran.
- **Documentation panel in the dashboard.** A `*.docs.json` in the set becomes a Documentation entry in the sidebar, ahead of the diagrams. Each claim renders with its confidence and its source in the same line of sight as its text — derived claims name the spec and generator that produced them, anchored claims link to the file (and line) in the repository, asserted claims read as "stated by <name> on <date>". A trust bar and a "needs attention" list sit in the side panel, a subject chip on each claim jumps to that node in its diagram, and the coverage block renders as a section of the document rather than a footnote. Filter by text or by "needs attention". `vibex dashboard --repo <dir>` checks anchors while building.
- `lifecycle` diagram type: states (initial, normal, waiting, terminal, failure) and transitions (actor, event, guard, action, auto/timeout/failure kinds), reachability and dead-end validation, dashboard section.

## [0.1.0] - 2026-09-18

First release.

### Added
- Three diagram types rendered from a validated JSON spec to a single self-contained HTML file: `erd`, `c4`, `endpoints`.
- Importers: OpenAPI 2/3 (JSON, or YAML when the optional `yaml` package is installed), GraphQL SDL (own parser, `--erd` seeds an ERD), Prisma schema.
- CLI `vibex`: `validate`, `render`, `import`, `dashboard`, `demo`, `types`; `--json` output for validate and render; exit codes 0/1/2.
- Dashboard: one HTML with a sidebar of every diagram, overview tiles, entity <-> endpoint cross-links, deep links (`#d=&node=`).
- Viewer: pan/zoom, search, details panel, dark/light theme, SVG and PNG export, keyboard shortcuts.
- SKILL.md so the folder installs as a Claude Code / Cursor skill.
- JSON Schemas for each type under `schemas/`, one example per type under `examples/`, `node:test` suite.

## Release checklist

Publishing happens in CI, on a tag. Nothing is published from a laptop — npm
requires an interactive 2FA prompt there, and a release should not depend on
somebody being awake for it.

1. `npm test` and `node bin/vibex.mjs demo out` pass with no `warning` lines on stderr.
2. Bump the version in `package.json`. `SKILL.md` (`metadata.version`) must match —
   a test enforces this, so a mismatch fails the build rather than shipping.
3. Move everything out of `## [Unreleased]` into a dated `## [x.y.z] - YYYY-MM-DD`
   section, and leave a fresh empty Unreleased behind. A test checks the version
   being shipped has a section.
4. `git commit -am "release x.y.z" && git tag -a vx.y.z -m "vx.y.z" && git push --follow-tags`.
   The tag must be annotated: `--follow-tags` pushes annotated tags only, so a
   lightweight `git tag vx.y.z` is silently left behind and the release never runs.
5. The `publish` workflow takes it from there: it refuses a tag that disagrees with
   `package.json`, runs the suite, installs the packed tarball into an empty
   directory and runs `vibex demo` against it, then publishes.
6. Confirm: `npx @vibex/vibex@x.y.z demo /tmp/vibex-smoke`.
7. Skill path: `npx skills add Raja0sama/vibex` in a scratch project, then
   `node ~/.claude/skills/vibex/bin/vibex.mjs types`.

Versioning is SemVer, pre-1.0: a new diagram or spec type, or anything that
changes what a generated file contains, is a minor. Bug fixes are a patch.
`schema_version` inside a spec is separate and only moves on a breaking change
to the authoring contract.
