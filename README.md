[![Continuous Integration](https://github.com/apollographql/subgraph-js/workflows/Continuous%20Integration/badge.svg)](https://github.com/apollographql/subgraph-js/actions?query=workflow%3A%22Continuous+Integration%22)
[![MIT License](https://img.shields.io/github/license/apollographql/subgraph-js.svg)](LICENSE)
[![NPM](https://img.shields.io/npm/v/%40apollo%2Fsubgraph)](https://www.npmjs.com/package/@apollo/subgraph)
[![Join the community forum](https://img.shields.io/badge/join%20the%20community-forum-blueviolet)](https://community.apollographql.com)

# @apollo/subgraph

Apollo Federation subgraph utilities for the `graphql-js` ecosystem.

`@apollo/subgraph` is built on top of `graphql-js` and provides transformation logic
to make your GraphQL schemas Federation compatible. `buildSubgraphSchema` adds common
Federation type definition (e.g. `Any` scalar, `_Entity` union, Federation directives, 
etc) and allows you to easily specify your Federated entity resolvers.

## Installation

```sh
npm install @apollo/subgraph graphql
```

## Usage

```ts
import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/subgraph';
import gql from 'graphql-tag';

const typeDefs = gql`
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key"])

  type Query {
    product(id: ID!): Product
  }

  type Product @key(fields: "id") {
    id: ID!
    name: String
  }
`;

const resolvers = {
  Query: {
    product: (_source, { id }) => products.find((product) => product.id === id),
  },
  Product: {
    // Called for each entity representation the router sends to `_entities`.
    __resolveReference: (reference) =>
      products.find((product) => product.id === reference.id),
  },
};

const server = new ApolloServer({
  schema: buildSubgraphSchema([{ typeDefs, resolvers }]),
});

await startStandaloneServer(server, { listen: { port: 4001 } });
```

### API

- **`buildSubgraphSchema(modulesOrSDL)`** — builds the executable subgraph schema.
  Accepts a `DocumentNode`, or an array of documents or `{ typeDefs, resolvers }`
  modules.
- **`printSubgraphSchema(schema)`** — prints the complete subgraph schema,
  federation directives and types included.
- **`addResolversToSchema(schema, resolvers)`** — attaches a resolver map to an
  existing schema, understanding `__resolveReference` alongside the usual
  `__resolveType` / `__isTypeOf`.
- **`entitiesResolver({ representations, context, info })`** — the `_entities`
  resolver, exported for libraries that assemble their own root fields.

Entity references are resolved through `__resolveReference`, either from a
resolver map or from `extensions.apollo.subgraph.resolveReference` on the type.

## Development

```sh
npm install
npm run build
npm test
```

The [`compatibility/`](./compatibility) package runs the
[Apollo Federation subgraph compatibility suite](https://github.com/apollographql/apollo-federation-subgraph-compatibility)
against this library, using docker compose for the router and reference subgraphs. 
See its [README](./compatibility/README.md).

```sh
cd compatibility
npm install
npm run compatibility
```

## Contact

If you have a specific question about the library or code, please start a discussion in the [Apollo community forums](https://community.apollographql.com/).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

After you have your local branch set up, take a look at our open issues to see where you can contribute.

## Security

For more info on how to contact the team for security issues, see our [Security Policy](https://github.com/apollographql/federation-jvm/security/policy).

## License

This library is licensed under [The MIT License (MIT)](LICENSE).
