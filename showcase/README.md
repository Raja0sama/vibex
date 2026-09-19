# Relay — the public showcase

A fictional parcel delivery network, documented the way vibeX is meant to be used:
four diagrams, two documents, and the source the documentation anchors into.

This is what [the demo](https://raja0sama.github.io/vibex/demo/dashboard.html) is built
from, on every deploy. It is deliberately a different domain from `examples/` — the
bundled examples are small and didactic, for the skill to read as a pattern; this is a
whole system, at the depth the tool is actually for.

| File | What it shows |
|---|---|
| `relay.c4.json` | 16 containers, nested boundaries, three external systems |
| `relay.erd.json` | 13 tables and enums in three bounded contexts |
| `relay.endpoints.json` | 17 operations across four audiences, plus published events |
| `parcel.lifecycle.json` | 12 states with retry loops, a waiting state and a recoverable failure |
| `relay.docs.json` | the system document — 102 claims, five stated gaps |
| `tracking.docs.json` | one topic in depth — 27 claims, four stated gaps |
| `src/`, `dispatch/` | the code every anchored claim points at |

Nothing here runs. It is the shape of a system, not a working one, and it ships with
the repository rather than the npm package.

```bash
node bin/vibex.mjs dashboard out/relay.html showcase --title "Relay" --repo showcase
node bin/vibex.mjs docs showcase/relay.docs.json showcase --repo showcase --check
```
