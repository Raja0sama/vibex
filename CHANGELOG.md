# Changelog

All notable changes to this project are recorded here. The format follows Keep a Changelog; versions follow SemVer.

## [Unreleased]

### Changed
- **Renamed the project to vibeX.** The CLI is now `vibex` (`bin/vibex.mjs`), the skill is `vibex`, the npm package is `@raja0sama/vibex`, and the repository is `Raja0sama/vibex`. Template slots renamed `<!-- ARCHGEN:* -->` → `<!-- VIBEX:* -->`; viewer globals `ArchgenViewer`/`ArchgenTheme` → `VibexViewer`/`VibexTheme`; SVG classes `.archgen*` → `.vibex*`; the theme `localStorage` key is now `vibex-theme` (viewers keep their own stored theme per origin, so a previously saved preference resets once).
- Redesigned the generated viewer shell: icon toolbar with segmented zoom/export controls, dot-grid canvas, floating hint pill, sectioned side panel, scrollable detail tables that drop empty columns, tinted note cards, styled scrollbars, and a print stylesheet.
- Dashboard: brand mark, per-type colour dots in the sidebar, a totals strip on the overview, tiles that lift on hover, and a two-column stat grid on phones.
- Diagram boxes get a soft drop shadow; the theme button now shows the theme you are switching to.

### Added
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

1. `npm test` and `node bin/vibex.mjs demo out` pass locally with no `warning` lines on stderr.
2. Bump the version in **both** `package.json` (`"version"`) and `SKILL.md` (`metadata.version`); they must be identical, e.g. `0.2.0`.
3. Add a `## [x.y.z] - YYYY-MM-DD` section and move items out of Unreleased.
4. `npm pack --dry-run` and confirm `assets/dashboard.html`, `assets/template.html`, `assets/viewer.js`, `assets/viewer.css`, `SKILL.md`, `LICENSE` are listed.
5. `git commit -am "release x.y.z" && git tag vx.y.z && git push --follow-tags`.
6. Wait for CI (Node 18/20/22) to be green on the tag.
7. Optional npm path: `npm publish --access public` (runs `prepublishOnly` = `npm test`). Smoke: `npx @raja0sama/vibex@x.y.z demo /tmp/vibex-smoke`.
8. Skill path smoke: `npx skills add Raja0sama/vibex` in a scratch project, then `node ~/.claude/skills/vibex/bin/vibex.mjs types`.
