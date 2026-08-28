/**
 * Resolution of `Query._entities`.
 *
 * The router sends a list of entity *representations* — objects carrying a
 * `__typename` and the fields of one of the entity's `@key`s — and expects the
 * corresponding entities back, in order. Each type resolves its own
 * representation through the `__resolveReference` resolver recorded on it.
 */
import {
  GraphQLAbstractType,
  GraphQLError,
  GraphQLInterfaceType,
  GraphQLObjectType,
  GraphQLResolveInfo,
  GraphQLSchema,
  defaultTypeResolver,
  isInterfaceType,
  isObjectType,
} from 'graphql';
import { maybeCacheControlFromInfo } from '@apollo/cache-control-types';
import {
  ApolloGraphQLInterfaceTypeExtensions,
  ApolloGraphQLObjectTypeExtensions,
  GraphQLReferenceResolver,
} from './schemaExtensions';

export const ANY_TYPE_NAME = '_Any';
export const ENTITY_TYPE_NAME = '_Entity';
export const SERVICE_TYPE_NAME = '_Service';
export const FIELD_SET_TYPE_NAME = '_FieldSet';
export const ENTITIES_FIELD_NAME = '_entities';
export const SERVICE_FIELD_NAME = '_service';
export const REPRESENTATIONS_ARGUMENT_NAME = 'representations';

type PromiseOrValue<T> = T | Promise<T>;

function isPromise<T>(value: PromiseOrValue<T>): value is Promise<T> {
  return typeof (value as { then?: unknown })?.then === 'function';
}

/** Minimal value formatter for error messages, so this module stays runtime-agnostic. */
function inspect(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

async function maybeAddTypeNameToPossibleReturn<
  T extends { __typename?: string },
>(maybeObject: PromiseOrValue<null | T>, typename: string): Promise<null | T> {
  const objectOrNull = await maybeObject;
  if (objectOrNull !== null && typeof objectOrNull === 'object') {
    // An existing, different `__typename` means we are refining an interface
    // reference to a concrete (or `@interfaceObject`) runtime type. Return a new
    // object in that case: `graphql-js` depends on the identity of the value it
    // already resolved, and mutating it in place produces execution errors.
    if ('__typename' in objectOrNull && objectOrNull.__typename !== typename) {
      return { ...objectOrNull, __typename: typename };
    }

    Object.defineProperty(objectOrNull, '__typename', { value: typename });
  }
  return objectOrNull;
}

/**
 * Adapted from `graphql-js`, which does not export the equivalent check.
 *
 * With `@key` on an interface we have to resolve the runtime type of whatever
 * `__resolveReference` returned. Letting `graphql-js` fail on its own produces a
 * message about `_Entity` needing a `resolveType`, which points the user at the
 * wrong type entirely.
 */
function ensureValidRuntimeType(
  runtimeTypeName: unknown,
  schema: GraphQLSchema,
  returnType: GraphQLAbstractType,
  result: unknown,
): GraphQLObjectType {
  if (runtimeTypeName == null) {
    throw new GraphQLError(
      `Abstract type "${returnType.name}" \`__resolveReference\` method must resolve to an Object type at runtime. Either the object returned by "${returnType}.__resolveReference" must include a valid \`__typename\` field, or the "${returnType.name}" type should provide a "resolveType" function or each possible type should provide an "isTypeOf" function.`,
    );
  }

  if (typeof runtimeTypeName !== 'string') {
    throw new GraphQLError(
      `Abstract type "${returnType.name}" \`__resolveReference\` method must resolve to an Object type at runtime with ` +
        `value ${inspect(result)}, received "${inspect(runtimeTypeName)}".`,
    );
  }

  const runtimeType = schema.getType(runtimeTypeName);
  if (runtimeType == null) {
    throw new GraphQLError(
      `Abstract type "${returnType.name}" \`__resolveReference\` method resolved to a type "${runtimeTypeName}" that does not exist inside the schema.`,
    );
  }

  if (!isObjectType(runtimeType)) {
    throw new GraphQLError(
      `Abstract type "${returnType.name}" \`__resolveReference\` method resolved to a non-object type "${runtimeTypeName}".`,
    );
  }

  if (!schema.isSubType(returnType, runtimeType)) {
    throw new GraphQLError(
      `Runtime Object type "${runtimeType.name}" \`__resolveReference\` method is not a possible type for "${returnType.name}".`,
    );
  }

  return runtimeType;
}

async function withResolvedType<T>({
  type,
  value,
  context,
  info,
  callback,
}: {
  type: GraphQLInterfaceType;
  value: any;
  context: any;
  info: GraphQLResolveInfo;
  callback: (runtimeType: GraphQLObjectType) => PromiseOrValue<T>;
}): Promise<T> {
  const resolvedValue = await value;
  if (resolvedValue === null) {
    return resolvedValue;
  }

  const resolveTypeFn = type.resolveType ?? defaultTypeResolver;
  const runtimeType = resolveTypeFn(resolvedValue, context, info, type);
  if (isPromise(runtimeType)) {
    return runtimeType.then((name) =>
      callback(ensureValidRuntimeType(name, info.schema, type, resolvedValue)),
    );
  }

  return callback(
    ensureValidRuntimeType(runtimeType, info.schema, type, resolvedValue),
  );
}

function definedResolveReference(
  type: GraphQLObjectType | GraphQLInterfaceType,
): GraphQLReferenceResolver<any> | undefined {
  const extensions:
    ApolloGraphQLObjectTypeExtensions | ApolloGraphQLInterfaceTypeExtensions =
    type.extensions;
  return extensions.apollo?.subgraph?.resolveReference;
}

export function entitiesResolver({
  representations,
  context,
  info,
}: {
  representations: any;
  context: any;
  info: GraphQLResolveInfo;
}) {
  return representations.map((reference: { __typename: string } & object) => {
    const { __typename } = reference;

    const type = info.schema.getType(__typename);
    if (!type || !(isObjectType(type) || isInterfaceType(type))) {
      throw new Error(
        `The _entities resolver tried to load an entity for type "${__typename}", but no object or interface type of that name was found in the schema`,
      );
    }

    // When running under Apollo Server with the cache control plugin enabled,
    // restrict the request's cache policy using the `@cacheControl` directive on
    // the type the representation selected. Returns null elsewhere.
    const cacheControl = maybeCacheControlFromInfo(info);
    if (cacheControl) {
      const cacheHint = cacheControl.cacheHintFromType(type);
      if (cacheHint) {
        cacheControl.cacheHint.restrict(cacheHint);
      }
    }

    const resolveReference = definedResolveReference(type);
    const result = resolveReference
      ? resolveReference(reference, context, info)
      : reference;

    if (isInterfaceType(type)) {
      return withResolvedType({
        type,
        value: result,
        context,
        info,
        callback: (runtimeType) => {
          // With no `__resolveReference` on the interface itself, fall back to
          // one on the resolved runtime type. If neither exists we behave as we
          // do for object types, and pass the reference straight through.
          let finalResult = maybeAddTypeNameToPossibleReturn(
            result,
            runtimeType.name,
          );
          if (!resolveReference) {
            const runtimeResolveReference =
              definedResolveReference(runtimeType);
            if (runtimeResolveReference) {
              // The runtime resolver sees a reference carrying the concrete
              // `__typename`, and we re-apply it afterwards in case the resolver
              // dropped it — matching how object type references behave.
              finalResult = isPromise(finalResult)
                ? finalResult.then((r) =>
                    runtimeResolveReference(r, context, info),
                  )
                : runtimeResolveReference(finalResult, context, info);
              finalResult = maybeAddTypeNameToPossibleReturn(
                finalResult,
                runtimeType.name,
              );
            }
          }
          return finalResult;
        },
      });
    }

    return maybeAddTypeNameToPossibleReturn(result, __typename);
  });
}
