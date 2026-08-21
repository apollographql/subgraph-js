import { GraphQLObjectType, GraphQLUnionType, graphql, parse } from 'graphql';
import gql from 'graphql-tag';
import { buildSubgraphSchema } from '../buildSubgraphSchema';
import {
  MultipleFederationLinksError,
  UnsupportedFederationVersionError,
  UnsupportedLinkImportError,
} from '../errors';

const fed2 = (
  version = 'v2.9',
  imports = '"@key", "@shareable", "@external", "@requires", "@provides", "@interfaceObject"',
) => `
  extend schema @link(url: "https://specs.apollo.dev/federation/${version}", import: [${imports}])
`;

function serviceSdl(schema: Parameters<typeof graphql>[0]['schema']) {
  return graphql({ schema, source: '{ _service { sdl } }' }).then((result) => {
    expect(result.errors).toBeUndefined();
    return (result.data as any)._service.sdl as string;
  });
}

describe('federation machinery', () => {
  it('adds _service to the query root', async () => {
    const schema = buildSubgraphSchema(
      parse(`${fed2()} type Query { hello: String }`),
    );

    const query = schema.getQueryType()!;
    expect(Object.keys(query.getFields())).toEqual(['hello', '_service']);
    await expect(serviceSdl(schema)).resolves.toContain('type Query');
  });

  it('creates a query root when the schema has none', () => {
    const schema = buildSubgraphSchema(
      parse(`${fed2()} type Product @key(fields: "id") { id: ID! }`),
    );

    expect(Object.keys(schema.getQueryType()!.getFields())).toEqual([
      '_entities',
      '_service',
    ]);
  });

  it('honours a renamed query root', () => {
    const schema = buildSubgraphSchema(
      parse(`
        ${fed2()}
        schema { query: RootQuery }
        type RootQuery { hello: String }
      `),
    );

    const query = schema.getQueryType()!;
    expect(query.name).toBe('RootQuery');
    expect(Object.keys(query.getFields())).toContain('_service');
  });

  it('omits _entities and _Entity when the schema has no entities', () => {
    const schema = buildSubgraphSchema(
      parse(`${fed2()} type Query { hello: String }`),
    );

    expect(schema.getQueryType()!.getFields()['_entities']).toBeUndefined();
    expect(schema.getType('_Entity')).toBeUndefined();
    expect(schema.getType('_Any')).toBeUndefined();
  });

  it('includes every keyed object type in _Entity', () => {
    const schema = buildSubgraphSchema(
      parse(`
        ${fed2()}
        type Query { hello: String }
        type Product @key(fields: "id") { id: ID! }
        type Review @key(fields: "id") @key(fields: "body") { id: ID! body: String }
        type Unkeyed { id: ID! }
      `),
    );

    const entity = schema.getType('_Entity') as GraphQLUnionType;
    expect(entity.getTypes().map((type) => type.name)).toEqual([
      'Product',
      'Review',
    ]);
  });

  it('treats implementations of a keyed interface as entities', () => {
    const schema = buildSubgraphSchema(
      parse(`
        ${fed2()}
        type Query { hello: String }
        interface Media @key(fields: "id") { id: ID! }
        type Book implements Media { id: ID! title: String }
      `),
    );

    const entity = schema.getType('_Entity') as GraphQLUnionType;
    expect(entity.getTypes().map((type) => type.name)).toEqual(['Book']);
  });
});

describe('entity resolution', () => {
  const typeDefs = gql`
    extend schema
      @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key"])

    type Query {
      hello: String
    }

    type Product @key(fields: "id") {
      id: ID!
      name: String
    }
  `;

  const entitiesQuery = `
    query ($representations: [_Any!]!) {
      _entities(representations: $representations) {
        ... on Product { id name }
      }
    }
  `;

  it('resolves references through __resolveReference', async () => {
    const schema = buildSubgraphSchema([
      {
        typeDefs,
        resolvers: {
          Product: {
            __resolveReference(reference: { id: string }) {
              return { id: reference.id, name: `Product ${reference.id}` };
            },
          },
        },
      },
    ]);

    const result = await graphql({
      schema,
      source: entitiesQuery,
      variableValues: {
        representations: [{ __typename: 'Product', id: '1' }],
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      _entities: [{ id: '1', name: 'Product 1' }],
    });
  });

  it('passes the representation through when no __resolveReference exists', async () => {
    const schema = buildSubgraphSchema(typeDefs);

    const result = await graphql({
      schema,
      source: entitiesQuery,
      variableValues: {
        representations: [{ __typename: 'Product', id: '1', name: 'Given' }],
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ _entities: [{ id: '1', name: 'Given' }] });
  });

  it('errors for a representation of an unknown type', async () => {
    const schema = buildSubgraphSchema(typeDefs);

    const result = await graphql({
      schema,
      source: entitiesQuery,
      variableValues: { representations: [{ __typename: 'Nope', id: '1' }] },
    });

    expect(result.errors?.[0].message).toMatch(
      /tried to load an entity for type "Nope"/,
    );
  });

  it('resolves interface entities to their runtime type', async () => {
    const schema = buildSubgraphSchema([
      {
        typeDefs: gql`
          extend schema
            @link(
              url: "https://specs.apollo.dev/federation/v2.9"
              import: ["@key"]
            )

          type Query {
            hello: String
          }

          interface Media @key(fields: "id") {
            id: ID!
          }

          type Book implements Media {
            id: ID!
            title: String
          }
        `,
        resolvers: {
          Media: {
            __resolveReference(reference: { id: string }) {
              return { __typename: 'Book', id: reference.id, title: 'Dune' };
            },
          },
        },
      },
    ]);

    const result = await graphql({
      schema,
      source: `
        query ($representations: [_Any!]!) {
          _entities(representations: $representations) {
            ... on Book { id title }
          }
        }
      `,
      variableValues: { representations: [{ __typename: 'Media', id: '1' }] },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ _entities: [{ id: '1', title: 'Dune' }] });
  });
});

describe('resolvers', () => {
  it('applies resolvers from every module', async () => {
    const schema = buildSubgraphSchema([
      {
        typeDefs: gql`
          ${fed2()}
          type Query {
            hello: String
          }
        `,
        resolvers: { Query: { hello: () => 'hi' } },
      },
      {
        typeDefs: gql`
          extend type Query {
            goodbye: String
          }
        `,
        resolvers: { Query: { goodbye: () => 'bye' } },
      },
    ]);

    const result = await graphql({ schema, source: '{ hello goodbye }' });
    expect(result.data).toEqual({ hello: 'hi', goodbye: 'bye' });
  });
});

describe('@link', () => {
  it('namespaces definitions that are not imported', () => {
    const schema = buildSubgraphSchema(
      parse(
        `${fed2('v2.9', '"@key"')} type Product @key(fields: "id") { id: ID! }`,
      ),
    );

    expect(schema.getDirective('key')).toBeDefined();
    expect(schema.getDirective('shareable')).toBeUndefined();
    expect(schema.getDirective('federation__shareable')).toBeDefined();
    expect(schema.getType('federation__FieldSet')).toBeDefined();
    expect(schema.getType('link__Purpose')).toBeDefined();
  });

  it('supports renamed imports', () => {
    const schema = buildSubgraphSchema(
      parse(`
        extend schema @link(
          url: "https://specs.apollo.dev/federation/v2.9",
          import: [{ name: "@key", as: "@primaryKey" }]
        )
        type Product @primaryKey(fields: "id") { id: ID! }
      `),
    );

    expect(schema.getDirective('primaryKey')).toBeDefined();
    expect(schema.getDirective('key')).toBeUndefined();
    // Entity detection follows the local name.
    expect(
      (schema.getType('_Entity') as GraphQLUnionType).getTypes(),
    ).toHaveLength(1);
  });

  it('only defines directives available in the linked version', () => {
    const older = buildSubgraphSchema(
      parse(`${fed2('v2.5', '"@key"')} type Query { hello: String }`),
    );
    expect(older.getDirective('federation__cost')).toBeUndefined();
    expect(older.getDirective('federation__cacheTag')).toBeUndefined();

    const newer = buildSubgraphSchema(
      parse(`${fed2('v2.12', '"@key"')} type Query { hello: String }`),
    );
    expect(newer.getDirective('federation__cost')).toBeDefined();
    expect(newer.getDirective('federation__cacheTag')).toBeDefined();
  });

  it('tracks per-version changes to a directive', () => {
    const before = buildSubgraphSchema(
      parse(`${fed2('v2.6', '"@override"')} type Query { hello: String }`),
    );
    expect(
      before.getDirective('override')!.args.map((arg) => arg.name),
    ).toEqual(['from']);

    const after = buildSubgraphSchema(
      parse(`${fed2('v2.7', '"@override"')} type Query { hello: String }`),
    );
    expect(after.getDirective('override')!.args.map((arg) => arg.name)).toEqual(
      ['from', 'label'],
    );
  });

  it('leaves user-provided definitions alone', () => {
    const schema = buildSubgraphSchema(
      parse(`
        ${fed2('v2.9', '"@key"')}
        directive @key(fields: String!) repeatable on OBJECT
        type Product @key(fields: "id") { id: ID! }
      `),
    );

    expect(schema.getDirective('key')!.args[0].type.toString()).toBe('String!');
  });

  it('rejects an unknown federation version', () => {
    expect(() =>
      buildSubgraphSchema(
        parse(`${fed2('v3.0')} type Query { hello: String }`),
      ),
    ).toThrow(UnsupportedFederationVersionError);
  });

  it('rejects an import the linked version does not define', () => {
    expect(() =>
      buildSubgraphSchema(
        parse(
          `${fed2('v2.5', '"@key", "@cost"')} type Query { hello: String }`,
        ),
      ),
    ).toThrow(UnsupportedLinkImportError);
  });

  it('rejects more than one federation @link', () => {
    expect(() =>
      buildSubgraphSchema(
        parse(`
          extend schema @link(url: "https://specs.apollo.dev/federation/v2.9")
          extend schema @link(url: "https://specs.apollo.dev/federation/v2.5")
          type Query { hello: String }
        `),
      ),
    ).toThrow(MultipleFederationLinksError);
  });

  it('defines @link for a schema that only links a custom specification', () => {
    const schema = buildSubgraphSchema(
      parse(`
        extend schema @link(url: "https://myspecs.dev/custom/v1.0", import: ["@custom"])
        directive @custom on OBJECT
        type Query { hello: String }
      `),
    );

    expect(schema.getDirective('link')).toBeDefined();
  });
});

describe('Federation 1', () => {
  const fed1Schema = () =>
    buildSubgraphSchema(
      parse(`
        type Query { hello: String }
        type Product @key(fields: "id") { id: ID! sku: String @external }
        extend type Review @key(fields: "id") { id: ID! }
      `),
    );

  it('defines the Federation 1 directives when there is no @link', () => {
    const schema = fed1Schema();

    expect(schema.getDirective('key')).toBeDefined();
    expect(schema.getDirective('external')).toBeDefined();
    expect(schema.getType('_FieldSet')).toBeDefined();
    expect(schema.getDirective('link')).toBeUndefined();
    // `resolvable` arrived with Federation 2.
    expect(schema.getDirective('key')!.args.map((arg) => arg.name)).toEqual([
      'fields',
    ]);
  });

  it('supports extending a type owned by another subgraph', () => {
    const review = fed1Schema().getType('Review') as GraphQLObjectType;
    expect(Object.keys(review.getFields())).toEqual(['id']);
    expect(
      (fed1Schema().getType('_Entity') as GraphQLUnionType).getTypes(),
    ).toHaveLength(2);
  });

  it('holds federation definitions back from _service { sdl }', async () => {
    const sdl = await serviceSdl(fed1Schema());

    expect(sdl).not.toMatch(/directive @key/);
    expect(sdl).not.toMatch(/scalar _FieldSet/);
    expect(sdl).not.toMatch(/_Entity/);
    expect(sdl).toMatch(/type Product @key\(fields: "id"\)/);
  });
});

describe('validation', () => {
  it('reports an unknown type', () => {
    expect(() =>
      buildSubgraphSchema(parse(`${fed2()} type Query { product: Product }`)),
    ).toThrow(/Unknown type "Product"/);
  });

  it('reports an unknown directive', () => {
    expect(() =>
      buildSubgraphSchema(
        parse(`${fed2()} type Query @unknown { hello: String }`),
      ),
    ).toThrow(/Unknown directive "@unknown"/);
  });

  it('reports a federation directive used in the wrong place', () => {
    expect(() =>
      buildSubgraphSchema(
        parse(`${fed2()} type Query { hello: String @key(fields: "id") }`),
      ),
    ).toThrow(/Directive "@key" may not be used on FIELD_DEFINITION/);
  });
});
