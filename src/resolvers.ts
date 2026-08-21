import {
  DocumentNode,
  GraphQLEnumType,
  GraphQLEnumValueConfig,
  GraphQLFieldResolver,
  GraphQLScalarType,
  GraphQLSchema,
  isAbstractType,
  isEnumType,
  isObjectType,
  isScalarType,
  Kind,
} from 'graphql';
import {
  ApolloGraphQLInterfaceTypeExtensions,
  ApolloGraphQLObjectTypeExtensions,
  ApolloGraphQLUnionTypeExtensions,
} from './schemaExtensions';

export interface GraphQLSchemaModule {
  typeDefs: DocumentNode;
  resolvers?: GraphQLResolverMap<any>;
}

export interface GraphQLResolverMap<TContext = Record<string, any>> {
  [typeName: string]:
    | {
        [fieldName: string]:
          | GraphQLFieldResolver<any, TContext>
          | {
              requires?: string;
              resolve?: GraphQLFieldResolver<any, TContext>;
              subscribe?: GraphQLFieldResolver<any, TContext>;
            };
      }
    | GraphQLScalarType
    | {
        [enumValue: string]: string | number;
      };
}

function isDocumentNode(value: unknown): value is DocumentNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === Kind.DOCUMENT
  );
}

/** Normalizes the several shapes `buildSubgraphSchema` accepts into modules. */
export function modulesFromSDL(
  modulesOrSDL: (GraphQLSchemaModule | DocumentNode)[] | DocumentNode,
): GraphQLSchemaModule[] {
  if (Array.isArray(modulesOrSDL)) {
    return modulesOrSDL.map((moduleOrSDL) =>
      isDocumentNode(moduleOrSDL) ? { typeDefs: moduleOrSDL } : moduleOrSDL,
    );
  }
  return [{ typeDefs: modulesOrSDL }];
}

function recordResolveReference(
  type: {
    extensions:
      | ApolloGraphQLObjectTypeExtensions
      | ApolloGraphQLInterfaceTypeExtensions
      | ApolloGraphQLUnionTypeExtensions;
  },
  resolveReference: unknown,
) {
  const existing = type.extensions;
  type.extensions = {
    ...existing,
    apollo: {
      ...existing.apollo,
      subgraph: {
        ...existing.apollo?.subgraph,
        resolveReference: resolveReference as any,
      },
    },
  };
}

/**
 * Attaches a resolver map to an already-built schema, in place.
 *
 * Recognises the federation-specific `__resolveReference` entry alongside the
 * usual `__resolveType` / `__isTypeOf` and field resolvers.
 */
export function addResolversToSchema(
  schema: GraphQLSchema,
  resolvers: GraphQLResolverMap<any>,
) {
  for (const [typeName, fieldConfigs] of Object.entries(resolvers)) {
    const type = schema.getType(typeName);
    if (!type) continue;

    if (isAbstractType(type)) {
      for (const [fieldName, fieldConfig] of Object.entries(fieldConfigs)) {
        if (fieldName === '__resolveReference') {
          recordResolveReference(type, fieldConfig);
        } else if (fieldName === '__resolveType') {
          type.resolveType = fieldConfig as any;
        }
      }
    }

    if (isScalarType(type)) {
      for (const key of Object.keys(fieldConfigs)) {
        const value = (fieldConfigs as any)[key];
        // Users commonly pass a partially-specified `GraphQLScalarType`; treat
        // `undefined` as "leave alone" rather than "unset". `null` still unsets.
        if (value !== undefined) {
          (type as any)[key] = value;
        }
      }
    }

    if (isEnumType(type)) {
      const newValues: { [key: string]: GraphQLEnumValueConfig } = {};
      for (const value of type.getValues()) {
        const overridden = (fieldConfigs as any)[value.name];
        newValues[value.name] = {
          value: overridden === undefined ? value.name : overridden,
          deprecationReason: value.deprecationReason,
          description: value.description,
          astNode: value.astNode,
          extensions: undefined,
        };
      }

      // In-place update, to avoid pulling in schema-walking machinery just to
      // swap the internal values of one enum.
      Object.assign(
        type,
        new GraphQLEnumType({ ...type.toConfig(), values: newValues }),
      );
    }

    if (!isObjectType(type)) continue;

    const fieldMap = type.getFields();
    for (const [fieldName, fieldConfig] of Object.entries(fieldConfigs)) {
      if (fieldName === '__resolveReference') {
        recordResolveReference(type, fieldConfig);
        continue;
      }
      if (fieldName === '__isTypeOf') {
        type.isTypeOf = fieldConfig as any;
        continue;
      }

      const field = fieldMap[fieldName];
      if (!field) continue;

      if (typeof fieldConfig === 'function') {
        field.resolve = fieldConfig;
      } else {
        field.resolve = (fieldConfig as any).resolve;
        field.subscribe = (fieldConfig as any).subscribe;
      }
    }
  }
}
