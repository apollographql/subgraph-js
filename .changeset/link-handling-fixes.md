---
'@apollo/subgraph': patch
---

Align `@link` handling with composition:

- `@link(as: ...)` is now honoured for the federation link, so elements that aren't imported are namespaced under the alias instead of `federation__`.
- `@link(url: "https://specs.apollo.dev/link/v1.0", import: [...])` now names `Import` and `Purpose` after its imports instead of always using `link__Import` / `link__Purpose`.
- A `@link` URL with a trailing slash after the version (`.../federation/v2.9/`) is now rejected, matching composition.
- A `@link` URL with extra path segments under a known specification (`https://specs.apollo.dev/federation/extra/v1.0`) now links a custom specification (`extra`), as in composition, instead of being read as a federation link.
