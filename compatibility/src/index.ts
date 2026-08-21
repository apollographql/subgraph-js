import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { parse } from 'graphql';
import { resolvers } from './resolvers';

const PORT = Number(process.env.PORT ?? 4001);

const typeDefs = parse(
  readFileSync(join(__dirname, '..', 'schema.graphql'), 'utf-8'),
);

async function main() {
  const server = new ApolloServer({
    schema: buildSubgraphSchema([{ typeDefs, resolvers }]),
  });

  const { url } = await startStandaloneServer(server, {
    listen: { port: PORT, host: '0.0.0.0' },
  });
  console.log(`Compatibility subgraph ready at ${url}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
