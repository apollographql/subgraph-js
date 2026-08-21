export {
  buildSubgraphSchema,
  type BuildSubgraphSchemaInput,
} from './buildSubgraphSchema';
export { printSubgraphSchema } from './printSubgraphSchema';

export {
  addResolversToSchema,
  modulesFromSDL,
  type GraphQLResolverMap,
  type GraphQLSchemaModule,
} from './resolvers';

export { entitiesResolver } from './types';

export {
  FederationError,
  GraphQLSchemaValidationError,
  MultipleFederationLinksError,
  UnsupportedFederationVersionError,
  UnsupportedLinkImportError,
} from './errors';

export {
  FEDERATION_SPEC_IDENTITY,
  LATEST_FEDERATION_VERSION,
  LINK_SPEC_IDENTITY,
  type SpecVersion,
} from './specs';

export type {
  ApolloGraphQLInterfaceTypeExtensions,
  ApolloGraphQLObjectTypeExtensions,
  ApolloGraphQLUnionTypeExtensions,
  GraphQLReferenceResolver,
} from './schemaExtensions';
