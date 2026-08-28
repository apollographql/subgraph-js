---
"@apollo/subgraph": minor
---

Reimplement `@apollo/subgraph` directly using `graphql-js` instead of `@apollo/federation-internals`, making it usable with any `graphql-js` compatible subgraph. Unless otherwise noted, behavior is intended to stay compatible with the previous implementation.

- **Use `graphql-js` functionality over custom logic.** All logic is now re-implemented using `graphql-js` functionality. `@apollo/federation-internals` is no longer a dependency.
- **`printSubgraphSchema` now prints the complete schema**, federation directives, types, and root fields included. NOTE: It is just a thin wrapper around `@graphql-tools/utils`'s `printSchemaWithDirectives`.
- **BREAKING: `LegacySchemaModule` input shape removed.** `buildSubgraphSchema` no longer accepts Apollo Server's old `{ typeDefs, resolvers }` object shape. Pass an array of `{ typeDefs, resolvers }` modules (or a bare `DocumentNode`) instead:

  ```diff
  - buildSubgraphSchema({ typeDefs, resolvers })
  + buildSubgraphSchema([{ typeDefs, resolvers }])
  ```
