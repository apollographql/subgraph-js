# Changelog

## 2.17.0

### Minor Changes

- [#24](https://github.com/apollographql/subgraph-js/pull/24) [`4d9e75c`](https://github.com/apollographql/subgraph-js/commit/4d9e75c45ee1158c0424112836be2d978a78d4ec) Thanks [@dariuszkuc](https://github.com/dariuszkuc)! - Add Apollo Connectors spec definitions. A subgraph that `@link`s `https://specs.apollo.dev/connect/v0.1` through `v0.4` now gets the `@connect` and `@source` directives and their supporting types, following the link's `import` list and `as` namespace, with the definitions composition (v2.15+) expects. Connector usage itself is still validated by composition.

  A connectors subgraph's `_service { sdl }` leaves out the `_service` / `_entities` fields and the `_Service`, `_Any` and `_Entity` types, which composition rejects in a connectors subgraph. The schema still serves them.

### Patch Changes

- [#23](https://github.com/apollographql/subgraph-js/pull/23) [`1f7d99a`](https://github.com/apollographql/subgraph-js/commit/1f7d99a089fd7dfeafbc34a776f4cde470feb1b2) Thanks [@dariuszkuc](https://github.com/dariuszkuc)! - Align `@link` handling with composition:

  - `@link(as: ...)` is now honoured for the federation link, so elements that aren't imported are namespaced under the alias instead of `federation__`.
  - `@link(url: "https://specs.apollo.dev/link/v1.0", import: [...])` now names `Import` and `Purpose` after its imports instead of always using `link__Import` / `link__Purpose`.
  - A `@link` URL with a trailing slash after the version (`.../federation/v2.9/`) is now rejected, matching composition.
  - A `@link` URL with extra path segments under a known specification (`https://specs.apollo.dev/federation/extra/v1.0`) now links a custom specification (`extra`), as in composition, instead of being read as a federation link.

## 2.16.0

### Minor Changes

- [#25](https://github.com/apollographql/subgraph-js/pull/25) [`2085b86`](https://github.com/apollographql/subgraph-js/commit/2085b865704b566cedd23fdf63770ac15461cb11) Thanks [@glasser](https://github.com/glasser)! - Allow `graphql` v17 as a peer dependency (`^16.11.0 || ^17.0.0`). CI now runs the test suite against both v16 and v17.

## 2.15.1

### Patch Changes

- [#17](https://github.com/apollographql/subgraph-js/pull/17) [`de906c3`](https://github.com/apollographql/subgraph-js/commit/de906c3ed06f4bf31c76da70aa5d844d7a7ee134) Thanks [@marklai1998](https://github.com/marklai1998)! - Restore Node.js 22 support. `engines.node` was set to `>=24.0.0` during the graphql-js rewrite without a documented Node 24 runtime requirement, which silently dropped the current Node 22 LTS. CI now tests Node 22 alongside 24 and latest.

## 2.15.0

This release is a generic reimplementation of `@apollo/subgraph`
that can be used with any `graphql-js` compatible subgraphs. Unless
otherwise noted, behavior is intended to stay compatible with the
previous implementation.

### Changed

- **Use `graphql-js` functionality over custom logic.** All logic is now
  re-implemented using `graphql-js` functionality. `@apollo/federation-internals` is no
  longer a dependency.
- **`printSubgraphSchema` now prints the complete schema**, federation
  directives, types, and root fields included. NOTE: It is just a thin wrapper around
  `@graphql-tools/utils`'s `printSchemaWithDirectives`.

### Removed

- **`LegacySchemaModule` input shape.** `buildSubgraphSchema` no longer accepts
  Apollo Server's old `{ typeDefs, resolvers }` object shape. Pass an array of
  `{ typeDefs, resolvers }` modules (or a bare `DocumentNode`) instead:

  ```diff
  - buildSubgraphSchema({ typeDefs, resolvers })
  + buildSubgraphSchema([{ typeDefs, resolvers }])
  ```
