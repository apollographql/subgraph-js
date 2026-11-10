import { GraphQLObjectType, GraphQLUnionType, graphql, parse } from 'graphql';
import gql from 'graphql-tag';
import { buildSubgraphSchema } from '../buildSubgraphSchema';
import {
  MultipleConnectLinksError,
  MultipleFederationLinksError,
  UnsupportedConnectVersionError,
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

  it('rejects a federation @link url with a trailing slash', () => {
    expect(() =>
      buildSubgraphSchema(
        parse(`${fed2('v2.9/')} type Query { hello: String }`),
      ),
    ).toThrow(UnsupportedFederationVersionError);
  });

  it('treats a url with extra path segments under federation as a custom specification', () => {
    const schema = buildSubgraphSchema(
      parse(`
        ${fed2('v2.9', '"@key"')}
        extend schema @link(url: "https://specs.apollo.dev/federation/extra/v1.0", import: ["@foo"])
        directive @foo on FIELD_DEFINITION
        type Product @key(fields: "id") { id: ID! name: String @foo }
      `),
    );

    expect(schema.getDirective('key')).toBeDefined();
    expect(
      (schema.getType('_Entity') as GraphQLUnionType).getTypes(),
    ).toHaveLength(1);
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

  it('namespaces federation definitions under the @link alias', () => {
    const schema = buildSubgraphSchema(
      parse(`
        extend schema @link(url: "https://specs.apollo.dev/federation/v2.9", as: "fed")
        type Product @fed__key(fields: "id") { id: ID! }
      `),
    );

    expect(schema.getDirective('fed__key')).toBeDefined();
    expect(schema.getDirective('federation__key')).toBeUndefined();
    expect(schema.getType('fed__FieldSet')).toBeDefined();
    expect(
      (schema.getType('_Entity') as GraphQLUnionType).getTypes(),
    ).toHaveLength(1);
  });

  it('names link specification types after the link spec imports', () => {
    const schema = buildSubgraphSchema(
      parse(`
        schema @link(url: "https://specs.apollo.dev/link/v1.0", import: ["Import", { name: "Purpose", as: "LinkPurpose" }]) {
          query: Query
        }
        extend schema @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key"])
        type Query { hello: String }
      `),
    );

    expect(schema.getType('Import')).toBeDefined();
    expect(schema.getType('LinkPurpose')).toBeDefined();
    expect(schema.getType('link__Import')).toBeUndefined();
    expect(schema.getType('link__Purpose')).toBeUndefined();
    expect(
      schema
        .getDirective('link')!
        .args.map((arg) => `${arg.name}: ${arg.type}`),
    ).toEqual([
      'url: String',
      'as: String',
      'for: LinkPurpose',
      'import: [Import]',
    ]);
  });

  it('namespaces link specification types that are not imported', () => {
    const schema = buildSubgraphSchema(
      parse(`
        schema @link(url: "https://specs.apollo.dev/link/v1.0") { query: Query }
        extend schema @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key"])
        type Query { hello: String }
      `),
    );

    expect(schema.getType('link__Import')).toBeDefined();
    expect(schema.getType('link__Purpose')).toBeDefined();
  });

  it('rejects an import the link specification does not define', () => {
    expect(() =>
      buildSubgraphSchema(
        parse(`
          schema @link(url: "https://specs.apollo.dev/link/v1.0", import: ["FieldSet"]) { query: Query }
          extend schema @link(url: "https://specs.apollo.dev/federation/v2.9")
          type Query { hello: String }
        `),
      ),
    ).toThrow(
      'Cannot import "FieldSet": it is not part of the link specification v1.0.',
    );
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

describe('Apollo Connectors', () => {
  const connect = (
    version = 'v0.3',
    linkArguments = 'import: ["@connect", "@source"]',
  ) => `
    extend schema
      @link(url: "https://specs.apollo.dev/federation/v2.12", import: ["@key"])
      @link(url: "https://specs.apollo.dev/connect/${version}", ${linkArguments})
  `;

  const usersSchema = `
    extend schema
      @source(name: "api", http: { baseURL: "https://api.example.com", headers: [{ name: "x-api-key", from: "x-api-key" }] })

    type Query {
      user(id: ID!): User
        @connect(
          source: "api"
          http: { GET: "/users/{$args.id}" }
          selection: "id name"
          entity: true
        )
    }

    type User @key(fields: "id") {
      id: ID!
      name: String
    }
  `;

  it('defines the imported connect directives', () => {
    const schema = buildSubgraphSchema(parse(`${connect()} ${usersSchema}`));

    const connectDirective = schema.getDirective('connect')!;
    expect(connectDirective.isRepeatable).toBe(true);
    expect(connectDirective.locations).toEqual(['FIELD_DEFINITION', 'OBJECT']);
    expect(
      connectDirective.args.map((arg) => `${arg.name}: ${arg.type}`),
    ).toEqual([
      'source: String',
      'id: String',
      'http: connect__ConnectHTTP',
      'batch: connect__ConnectBatch',
      'errors: connect__ConnectorErrors',
      'selection: connect__JSONSelection!',
      'entity: Boolean',
      'isSuccess: connect__JSONSelection',
    ]);
    expect(schema.getDirective('source')!.locations).toEqual(['SCHEMA']);
  });

  it('publishes the connect definitions composition expects', async () => {
    const sdl = await serviceSdl(
      buildSubgraphSchema(parse(`${connect()} ${usersSchema}`)),
    );

    expect(sdl).toContain(
      'directive @connect(source: String, id: String, http: connect__ConnectHTTP, batch: connect__ConnectBatch, errors: connect__ConnectorErrors, selection: connect__JSONSelection!, entity: Boolean = false, isSuccess: connect__JSONSelection) repeatable on FIELD_DEFINITION | OBJECT',
    );
    expect(sdl).toContain(
      'directive @source(name: String!, http: connect__SourceHTTP!, errors: connect__ConnectorErrors, isSuccess: connect__JSONSelection) repeatable on SCHEMA',
    );
    expect(sdl).toContain('scalar connect__JSONSelection');
    expect(sdl).toContain('scalar connect__URLTemplate');
    expect(sdl).toContain(
      [
        'input connect__ConnectorErrors {',
        '  message: connect__JSONSelection',
        '  extensions: connect__JSONSelection',
        '}',
      ].join('\n'),
    );
    expect(sdl).toContain(
      [
        'input connect__HTTPHeaderMapping {',
        '  name: String!',
        '  from: String',
        '  value: String',
        '}',
      ].join('\n'),
    );
    expect(sdl).toContain(
      ['input connect__ConnectBatch {', '  maxSize: Int', '}'].join('\n'),
    );
    expect(sdl).toContain(
      [
        'input connect__SourceHTTP {',
        '  baseURL: String!',
        '  headers: [connect__HTTPHeaderMapping!]',
        '  path: connect__JSONSelection',
        '  queryParams: connect__JSONSelection',
        '}',
      ].join('\n'),
    );
    expect(sdl).toContain(
      [
        'input connect__ConnectHTTP {',
        '  GET: connect__URLTemplate',
        '  POST: connect__URLTemplate',
        '  PUT: connect__URLTemplate',
        '  PATCH: connect__URLTemplate',
        '  DELETE: connect__URLTemplate',
        '  body: connect__JSONSelection',
        '  headers: [connect__HTTPHeaderMapping!]',
        '  path: connect__JSONSelection',
        '  queryParams: connect__JSONSelection',
        '}',
      ].join('\n'),
    );
  });

  it('leaves the _service and _entities machinery out of _service { sdl }', async () => {
    const schema = buildSubgraphSchema(parse(`${connect()} ${usersSchema}`));
    const sdl = await serviceSdl(schema);

    // Still served by the subgraph...
    expect(schema.getQueryType()!.getFields()._service).toBeDefined();
    expect(schema.getQueryType()!.getFields()._entities).toBeDefined();
    // ...but composition rejects them in a connectors subgraph.
    expect(sdl).not.toMatch(/_service|_entities|_Service|_Entity|_Any/);
    expect(sdl).toMatch(/type User @key\(fields: "id"\)/);
    expect(sdl).toMatch(/directive @connect\(/);
  });

  it('namespaces connect definitions that are not imported', () => {
    const schema = buildSubgraphSchema(
      parse(`
        ${connect('v0.3', 'import: ["@connect"]')}
        type Query {
          hello: String @connect(http: { GET: "https://api.example.com/hello" }, selection: "$")
        }
      `),
    );

    expect(schema.getDirective('connect')).toBeDefined();
    expect(schema.getDirective('source')).toBeUndefined();
    expect(schema.getDirective('connect__source')).toBeDefined();
  });

  it('names @connect after the namespace when it is not imported', () => {
    const schema = buildSubgraphSchema(
      parse(`
        ${connect('v0.3', 'import: []')}
        type Query {
          hello: String @connect(http: { GET: "https://api.example.com/hello" }, selection: "$")
        }
      `),
    );

    expect(schema.getDirective('connect')).toBeDefined();
    expect(schema.getDirective('connect__connect')).toBeUndefined();
    expect(schema.getDirective('connect__source')).toBeDefined();
    expect(schema.getType('connect__ConnectHTTP')).toBeDefined();
  });

  it('namespaces connect definitions under the @link alias', () => {
    const schema = buildSubgraphSchema(
      parse(`
        ${connect('v0.3', 'as: "rest"')}
        type Query {
          hello: String @rest(http: { GET: "https://api.example.com/hello" }, selection: "$")
        }
      `),
    );

    expect(schema.getDirective('rest')).toBeDefined();
    expect(schema.getDirective('rest__connect')).toBeUndefined();
    expect(schema.getDirective('connect')).toBeUndefined();
    expect(schema.getDirective('rest__source')).toBeDefined();
    expect(schema.getType('rest__ConnectHTTP')).toBeDefined();
  });

  it('supports renamed connect imports', () => {
    const schema = buildSubgraphSchema(
      parse(`
        ${connect('v0.3', 'import: [{ name: "@connect", as: "@http" }, "JSONSelection"]')}
        type Query {
          hello: String @http(http: { GET: "https://api.example.com/hello" }, selection: "$")
        }
      `),
    );

    expect(schema.getDirective('http')).toBeDefined();
    expect(schema.getDirective('connect')).toBeUndefined();
    expect(schema.getType('JSONSelection')).toBeDefined();
    expect(String(schema.getDirective('http')!.args[5].type)).toBe(
      'JSONSelection!',
    );
  });

  it('accepts connectors on types and connectors without http', () => {
    expect(() =>
      buildSubgraphSchema(
        parse(`
          ${connect('v0.4')}
          type Query {
            greeting(name: String!): String! @connect(selection: "$args.name")
          }
          type User
            @connect(http: { GET: "https://api.example.com/users/{$this.id}" }, selection: "id name")
            @connect(http: { GET: "https://api.example.com/users/{$this.id}/details" }, selection: "id email")
          {
            id: ID!
            name: String
            email: String
          }
        `),
      ),
    ).not.toThrow();
  });

  it.each(['v0.1', 'v0.2', 'v0.3', 'v0.4'])(
    'supports connect %s',
    (version) => {
      const schema = buildSubgraphSchema(
        parse(`${connect(version)} ${usersSchema}`),
      );
      expect(schema.getDirective('connect')).toBeDefined();
    },
  );

  it.each(['v0.0', 'v0.5', 'v1.0', 'latest', 'v0.3/'])(
    'rejects connect %s',
    (version) => {
      expect(() =>
        buildSubgraphSchema(parse(`${connect(version)} ${usersSchema}`)),
      ).toThrow(UnsupportedConnectVersionError);
    },
  );

  it('imports the URLTemplate scalar under the name composition uses', () => {
    const schema = buildSubgraphSchema(
      parse(`
        ${connect('v0.3', 'import: ["@connect", "URLTemplate"]')}
        type Query { hello: String }
      `),
    );

    expect(schema.getType('URLTemplate')).toBeDefined();
    expect(() =>
      buildSubgraphSchema(
        parse(`
          ${connect('v0.3', 'import: ["@connect", "URLPathTemplate"]')}
          type Query { hello: String }
        `),
      ),
    ).toThrow(UnsupportedLinkImportError);
  });

  it('rejects an import the connect specification does not define', () => {
    expect(() =>
      buildSubgraphSchema(
        parse(`
          ${connect('v0.3', 'import: ["@connect", "@key"]')}
          type Query { hello: String }
        `),
      ),
    ).toThrow(
      'Cannot import "@key": it is not part of the connect specification v0.3.',
    );
  });

  it('rejects more than one connect @link', () => {
    expect(() =>
      buildSubgraphSchema(
        parse(`
          ${connect()}
          extend schema @link(url: "https://specs.apollo.dev/connect/v0.2")
          type Query { hello: String }
        `),
      ),
    ).toThrow(MultipleConnectLinksError);
  });

  it('leaves user-provided connect definitions alone', () => {
    const schema = buildSubgraphSchema(
      parse(`
        ${connect()}
        directive @connect(http: connect__ConnectHTTP, selection: String!) on FIELD_DEFINITION
        type Query {
          hello: String @connect(http: { GET: "https://api.example.com/hello" }, selection: "$")
        }
      `),
    );

    expect(schema.getDirective('connect')!.args.map((arg) => arg.name)).toEqual(
      ['http', 'selection'],
    );
  });

  it('defines the connect directives without a federation @link', () => {
    const schema = buildSubgraphSchema(
      parse(`
        extend schema @link(url: "https://specs.apollo.dev/connect/v0.3", import: ["@connect"])
        type Query {
          hello: String @connect(http: { GET: "https://api.example.com/hello" }, selection: "$")
        }
      `),
    );

    expect(schema.getDirective('connect')).toBeDefined();
    expect(schema.getDirective('link')).toBeDefined();
  });

  it('leaves validating connector usage to composition', () => {
    // Two HTTP methods and `entity: true` on a non-`Query` field are both
    // invalid connectors, but only composition reports that.
    expect(() =>
      buildSubgraphSchema(
        parse(`
          ${connect()}
          type Query { user: User }
          type User {
            id: ID!
            name: String
              @connect(
                http: { GET: "https://a.example.com", POST: "https://b.example.com" }
                selection: "name"
                entity: true
              )
          }
        `),
      ),
    ).not.toThrow();
  });

  it('still reports GraphQL errors in connect directive applications', () => {
    expect(() =>
      buildSubgraphSchema(
        parse(`
          ${connect()}
          type Query {
            hello: String @connect(http: { GET: "https://api.example.com/hello" })
          }
        `),
      ),
    ).toThrow(
      /Directive "@connect" argument "selection" of type "connect__JSONSelection!" is required/,
    );
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
