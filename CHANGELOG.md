# Changelog

## 2.15.0

### Minor Changes

- [#3](https://github.com/apollographql/subgraph-js/pull/3) [`ce5c255`](https://github.com/apollographql/subgraph-js/commit/ce5c2550a051d7a40adadf1f3cc8d22614f7cf53) Thanks [@dariuszkuc](https://github.com/dariuszkuc)! - Reimplement `@apollo/subgraph` directly using `graphql-js` instead of `@apollo/federation-internals`, making it usable with any `graphql-js` compatible subgraph. Unless otherwise noted, behavior is intended to stay compatible with the previous implementation.

  - **Use `graphql-js` functionality over custom logic.** All logic is now re-implemented using `graphql-js` functionality. `@apollo/federation-internals` is no longer a dependency.
  - **`printSubgraphSchema` now prints the complete schema**, federation directives, types, and root fields included. NOTE: It is just a thin wrapper around `@graphql-tools/utils`'s `printSchemaWithDirectives`.
  - **BREAKING: `LegacySchemaModule` input shape removed.** `buildSubgraphSchema` no longer accepts Apollo Server's old `{ typeDefs, resolvers }` object shape. Pass an array of `{ typeDefs, resolvers }` modules (or a bare `DocumentNode`) instead:

    ```diff
    - buildSubgraphSchema({ typeDefs, resolvers })
    + buildSubgraphSchema([{ typeDefs, resolvers }])
    ```

## 15.0.0-alpha.1

### Minor Changes

- [#3](https://github.com/apollographql/subgraph-js/pull/3) [`ce5c255`](https://github.com/apollographql/subgraph-js/commit/ce5c2550a051d7a40adadf1f3cc8d22614f7cf53) Thanks [@dariuszkuc](https://github.com/dariuszkuc)! - Reimplement `@apollo/subgraph` directly using `graphql-js` instead of `@apollo/federation-internals`, making it usable with any `graphql-js` compatible subgraph. Unless otherwise noted, behavior is intended to stay compatible with the previous implementation.

  - **Use `graphql-js` functionality over custom logic.** All logic is now re-implemented using `graphql-js` functionality. `@apollo/federation-internals` is no longer a dependency.
  - **`printSubgraphSchema` now prints the complete schema**, federation directives, types, and root fields included. NOTE: It is just a thin wrapper around `@graphql-tools/utils`'s `printSchemaWithDirectives`.
  - **BREAKING: `LegacySchemaModule` input shape removed.** `buildSubgraphSchema` no longer accepts Apollo Server's old `{ typeDefs, resolvers }` object shape. Pass an array of `{ typeDefs, resolvers }` modules (or a bare `DocumentNode`) instead:

    ```diff
    - buildSubgraphSchema({ typeDefs, resolvers })
    + buildSubgraphSchema([{ typeDefs, resolvers }])
    ```

All notable changes to this project are documented in this file.

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
