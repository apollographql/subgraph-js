import { buildSchema, parse } from 'graphql';
import { buildSubgraphSchema } from '../buildSubgraphSchema';
import { printSubgraphSchema } from '../printSubgraphSchema';

describe('printSubgraphSchema', () => {
  it('prints the complete schema, directive applications included', () => {
    const sdl = `
      extend schema @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key", "@shareable", "@tag"])

      type Query {
        product(id: ID!): Product
      }

      type Product @key(fields: "id") {
        id: ID!
        name: String @tag(name: "public")
      }

      type Dimensions @shareable {
        size: String
      }
    `;

    const printed = printSubgraphSchema(buildSubgraphSchema(parse(sdl)));

    expect(printed).toMatch(/type Product @key\(fields: "id"\)/);
    expect(printed).toMatch(/name: String @tag\(name: "public"\)/);
    expect(printed).toMatch(/type Dimensions @shareable/);
  });

  it('includes the definitions the library contributed', () => {
    const printed = printSubgraphSchema(
      buildSubgraphSchema(
        parse(`
          extend schema @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key"])
          type Product @key(fields: "id") { id: ID! }
        `),
      ),
    );

    expect(printed).toMatch(/directive @link/);
    expect(printed).toMatch(/_entities/);
    expect(printed).toMatch(/_service/);
    expect(printed).toMatch(/union _Entity = Product/);
  });

  it('is deterministic across calls on the same schema', () => {
    const sdl = `
      extend schema @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key", "@external", "@requires"])

      type Query {
        me: User
      }

      type User @key(fields: "email") {
        email: ID!
        totalProductsCreated: Int @external
        averageProductsCreatedPerYear: Int @requires(fields: "totalProductsCreated")
      }
    `;

    const schema = buildSubgraphSchema(parse(sdl));

    expect(printSubgraphSchema(schema)).toBe(printSubgraphSchema(schema));
  });

  it('reconstructs SDL for a schema it did not build', () => {
    // No federation metadata to read: fall back to the schema's AST nodes.
    const schema = buildSchema(`
      directive @key(fields: String!) repeatable on OBJECT

      type Query {
        product: Product
        _service: _Service!
      }

      type _Service {
        sdl: String
      }

      type Product @key(fields: "id") {
        id: ID!
      }
    `);

    const printed = printSubgraphSchema(schema);

    expect(printed).toMatch(/type Product @key\(fields: "id"\)/);
    expect(printed).toMatch(/_service: _Service!/);
    expect(printed).toMatch(/type _Service/);
  });
});
