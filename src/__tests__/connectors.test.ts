import { graphql, parse } from 'graphql';
import { buildSubgraphSchema } from '../buildSubgraphSchema';
import {
  MultipleConnectLinksError,
  UnsupportedConnectVersionError,
  UnsupportedLinkImportError,
} from '../errors';

function serviceSdl(schema: Parameters<typeof graphql>[0]['schema']) {
  return graphql({ schema, source: '{ _service { sdl } }' }).then((result) => {
    expect(result.errors).toBeUndefined();
    return (result.data as any)._service.sdl as string;
  });
}

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
