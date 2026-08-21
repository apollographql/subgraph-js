/**
 * Printing a subgraph schema back to SDL.
 *
 * This prints the *complete* schema — federation directives, types and
 * root fields included. Just delegates a call to `@graphql-tools/utils`'s
 * `printSchemaWithDirectives` as the `graphql-js`'s own `printSchema` does not
 * include directive *applications*.
 */
import { GraphQLSchema } from 'graphql';
import { printSchemaWithDirectives } from '@graphql-tools/utils';

export function printSubgraphSchema(schema: GraphQLSchema): string {
  return printSchemaWithDirectives(schema);
}
