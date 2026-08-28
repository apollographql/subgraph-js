import gql from 'graphql-tag';
import { buildSubgraphSchema } from '../buildSubgraphSchema';
import { MultipleFederationLinksError } from '../errors';

const link = gql`
  extend schema
    @link(
      url: "https://specs.apollo.dev/federation/v2.9"
      import: ["@key", "@shareable", "@external"]
    )
`;

describe('modules defining the same type', () => {
  it('rejects a type repeated across modules without `extend type`', () => {
    expect(() =>
      buildSubgraphSchema([
        {
          typeDefs: gql`
            ${link}
            type Query {
              product: Product
            }
            type Product @key(fields: "id") {
              id: ID!
              name: String
            }
          `,
        },
        {
          // Splitting a type's fields across modules needs `extend type`, same
          // as building a plain `graphql-js` schema from concatenated SDL.
          typeDefs: gql`
            type Product {
              reviewCount: Int
            }
          `,
        },
      ]),
    ).toThrow(/There can be only one type named "Product"/);
  });

  it('rejects a type repeated with identical contents', () => {
    expect(() =>
      buildSubgraphSchema([
        {
          typeDefs: gql`
            ${link}
            type Query {
              hello: String
            }
            type Money {
              amount: Int
            }
          `,
        },
        {
          typeDefs: gql`
            type Money {
              amount: Int
            }
          `,
        },
      ]),
    ).toThrow(/There can be only one type named "Money"/);
  });

  it('rejects a field defined twice with conflicting types', () => {
    expect(() =>
      buildSubgraphSchema([
        {
          typeDefs: gql`
            ${link}
            type Query {
              hello: String
            }
          `,
        },
        {
          typeDefs: gql`
            type Product {
              id: ID!
            }
          `,
        },
        {
          typeDefs: gql`
            type Product {
              id: Int!
            }
          `,
        },
      ]),
    ).toThrow(/There can be only one type named "Product"/);
  });

  it('rejects the same name defined as two different kinds', () => {
    expect(() =>
      buildSubgraphSchema([
        {
          typeDefs: gql`
            ${link}
            type Query {
              hello: String
            }
          `,
        },
        {
          typeDefs: gql`
            type Product {
              id: ID!
            }
          `,
        },
        {
          typeDefs: gql`
            interface Product {
              id: ID!
            }
          `,
        },
      ]),
    ).toThrow(/There can be only one type named "Product"/);
  });

  it('combines a definition and an extension of the same type', () => {
    const schema = buildSubgraphSchema([
      {
        typeDefs: gql`
          ${link}
          type Query {
            hello: String
          }
        `,
      },
      {
        typeDefs: gql`
          type Product @key(fields: "id") {
            id: ID!
          }
        `,
      },
      {
        typeDefs: gql`
          extend type Product {
            price: Int
          }
        `,
      },
    ]);

    const product = schema.getType(
      'Product',
    ) as import('graphql').GraphQLObjectType;
    expect(Object.keys(product.getFields())).toEqual(['id', 'price']);
  });

  it('rejects a federation `@link` repeated identically across modules', () => {
    // Modules that each carry their own copy of the shared header collide, the
    // same as concatenating that SDL directly would.
    expect(() =>
      buildSubgraphSchema([
        {
          typeDefs: gql`
            ${link}
            type Query {
              hello: String
            }
          `,
        },
        {
          typeDefs: link,
        },
      ]),
    ).toThrow(MultipleFederationLinksError);
  });

  it('rejects a second `schema { ... }` definition', () => {
    expect(() =>
      buildSubgraphSchema([
        {
          typeDefs: gql`
            schema {
              query: RootQuery
            }
            type RootQuery {
              hello: String
            }
          `,
        },
        {
          typeDefs: gql`
            schema {
              mutation: RootMutation
            }
            type RootMutation {
              noop: Boolean
            }
          `,
        },
      ]),
    ).toThrow(/Must provide only one schema definition/);
  });
});
