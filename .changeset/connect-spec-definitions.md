---
'@apollo/subgraph': minor
---

Add Apollo Connectors spec definitions. A subgraph that `@link`s `https://specs.apollo.dev/connect/v0.1` through `v0.4` now gets the `@connect` and `@source` directives and their supporting types, following the link's `import` list and `as` namespace, with the definitions composition (v2.15+) expects. Connector usage itself is still validated by composition.

A connectors subgraph's `_service { sdl }` leaves out the `_service` / `_entities` fields and the `_Service`, `_Any` and `_Entity` types, which composition rejects in a connectors subgraph. The schema still serves them.
