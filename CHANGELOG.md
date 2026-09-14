# Changelog

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
