---
'@apollo/subgraph': minor
---

Add Apollo Connectors spec definitions. A subgraph that `@link`s `https://specs.apollo.dev/connect/v0.1` through `v0.4` now gets the `@connect` and `@source` directives and their supporting types, following the link's `import` list and `as` namespace. Connector usage itself is still validated by composition.

`@link(as: ...)` is now honoured for the federation link too, so elements that aren't imported are namespaced under the alias instead of `federation__`.
