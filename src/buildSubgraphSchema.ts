import {
  DefinitionNode,
  DocumentNode,
  GraphQLSchema,
  Kind,
  ObjectTypeDefinitionNode,
  ObjectTypeExtensionNode,
  TypeDefinitionNode,
  TypeExtensionNode,
  buildASTSchema,
  concatAST,
  isTypeDefinitionNode,
  isTypeExtensionNode,
  parse,
  print,
  validateSchema,
} from 'graphql';
import { GraphQLSchemaValidationError } from './errors';
import {
  FEDERATION_NAMESPACE,
  LINK_NAMESPACE,
  applyLinkNaming,
  findFederationLink,
  hasLinkDirective,
  linkedDirectiveName,
} from './link';
import {
  GraphQLSchemaModule,
  addResolversToSchema,
  modulesFromSDL,
} from './resolvers';
import {
  federation1SpecDocument,
  federationSpecDocument,
  linkSpecDocument,
} from './specs';
import {
  ANY_TYPE_NAME,
  ENTITIES_FIELD_NAME,
  ENTITY_TYPE_NAME,
  REPRESENTATIONS_ARGUMENT_NAME,
  SERVICE_FIELD_NAME,
  SERVICE_TYPE_NAME,
  entitiesResolver,
} from './types';

export type BuildSubgraphSchemaInput =
  (GraphQLSchemaModule | DocumentNode)[] | DocumentNode;

/**
 * Builds an executable subgraph schema from federation SDL.
 *
 * The schema gains whatever the document `@link`s from the federation
 * specification, plus the `_service` and `_entities` root fields the router uses
 * to introspect and resolve entities.
 */
export function buildSubgraphSchema(
  modulesOrSDL: BuildSubgraphSchemaInput,
): GraphQLSchema {
  const modules = modulesFromSDL(modulesOrSDL);
  const userDocument = concatAST(modules.map((module) => module.typeDefs));

  const subgraph = buildSubgraph(userDocument);

  // `buildASTSchema` validates the SDL, then `validateSchema` validates the
  // result. Federation-specific rules (that a `@key` field set resolves, that
  // `@requires` selections exist, ...) are composition's job, not ours.
  const schema = buildASTSchema(subgraph.document);
  const errors = validateSchema(schema);
  if (errors.length > 0) {
    throw new GraphQLSchemaValidationError(errors);
  }

  addResolversToSchema(schema, {
    [subgraph.queryRootName]: {
      _service: () => ({ sdl: subgraph.serviceSdl() }),
    },
  });

  if (subgraph.entityTypeNames.length > 0) {
    addResolversToSchema(schema, {
      [subgraph.queryRootName]: {
        _entities: (_source, { representations }, context, info) =>
          entitiesResolver({ representations, context, info }),
      },
      [ENTITY_TYPE_NAME]: {
        __resolveType(parent: { __typename: string }) {
          return parent.__typename;
        },
      },
    });
  }

  for (const module of modules) {
    if (!module.resolvers) continue;
    addResolversToSchema(schema, module.resolvers);
  }

  return schema;
}

interface FederationElementNames {
  directives: string[];
  types: string[];
}

interface Subgraph {
  /** The document to hand to `buildASTSchema`. */
  document: DocumentNode;
  /** Computes the SDL for `_service { sdl }`. Only printed when called. */
  serviceSdl: () => string;
  queryRootName: string;
  entityTypeNames: string[];
  isFederation2: boolean;
}

const extensionKindToDefinitionKind = {
  [Kind.SCALAR_TYPE_EXTENSION]: Kind.SCALAR_TYPE_DEFINITION,
  [Kind.OBJECT_TYPE_EXTENSION]: Kind.OBJECT_TYPE_DEFINITION,
  [Kind.INTERFACE_TYPE_EXTENSION]: Kind.INTERFACE_TYPE_DEFINITION,
  [Kind.UNION_TYPE_EXTENSION]: Kind.UNION_TYPE_DEFINITION,
  [Kind.ENUM_TYPE_EXTENSION]: Kind.ENUM_TYPE_DEFINITION,
  [Kind.INPUT_OBJECT_TYPE_EXTENSION]: Kind.INPUT_OBJECT_TYPE_DEFINITION,
} as const;

function hasDirective(
  node: { directives?: ReadonlyArray<{ name: { value: string } }> },
  name: string,
): boolean {
  return (
    node.directives?.some((directive) => directive.name.value === name) ?? false
  );
}

function definitionName(definition: DefinitionNode): string | undefined {
  return 'name' in definition ? definition.name?.value : undefined;
}

/** Query root type name, honouring a `schema { query: ... }` declaration. */
function findQueryRootName(document: DocumentNode): string {
  for (const definition of document.definitions) {
    if (
      definition.kind !== Kind.SCHEMA_DEFINITION &&
      definition.kind !== Kind.SCHEMA_EXTENSION
    ) {
      continue;
    }
    for (const operationType of definition.operationTypes ?? []) {
      if (operationType.operation === 'query')
        return operationType.type.name.value;
    }
  }
  return 'Query';
}

/**
 * Object types the router may resolve through `_entities`: those carrying a
 * `@key`, plus those implementing an interface that carries one.
 */
function findEntityTypeNames(
  document: DocumentNode,
  keyDirectiveName: string,
): string[] {
  const keyedInterfaces = new Set<string>();
  const entities = new Set<string>();
  const objects: (ObjectTypeDefinitionNode | ObjectTypeExtensionNode)[] = [];

  for (const definition of document.definitions) {
    switch (definition.kind) {
      case Kind.INTERFACE_TYPE_DEFINITION:
      case Kind.INTERFACE_TYPE_EXTENSION:
        if (hasDirective(definition, keyDirectiveName)) {
          keyedInterfaces.add(definition.name.value);
        }
        break;
      case Kind.OBJECT_TYPE_DEFINITION:
      case Kind.OBJECT_TYPE_EXTENSION:
        objects.push(definition);
        if (hasDirective(definition, keyDirectiveName)) {
          entities.add(definition.name.value);
        }
        break;
      default:
        break;
    }
  }

  for (const object of objects) {
    for (const implemented of object.interfaces ?? []) {
      if (keyedInterfaces.has(implemented.name.value)) {
        entities.add(object.name.value);
      }
    }
  }

  return [...entities].sort();
}

/**
 * Synthesizes an empty definition for every type that is only ever extended.
 * Federation subgraphs routinely `extend type` a type owned by another subgraph,
 * which plain `graphql-js` rejects as extending an undefined type.
 */
function synthesizeMissingDefinitions(
  document: DocumentNode,
): TypeDefinitionNode[] {
  const defined = new Set<string>();
  const extensions = new Map<string, TypeExtensionNode>();

  for (const definition of document.definitions) {
    if (isTypeDefinitionNode(definition)) {
      defined.add(definition.name.value);
    } else if (isTypeExtensionNode(definition)) {
      if (!extensions.has(definition.name.value)) {
        extensions.set(definition.name.value, definition);
      }
    }
  }

  const synthesized: TypeDefinitionNode[] = [];
  for (const [name, extension] of extensions) {
    if (defined.has(name)) continue;
    synthesized.push({
      kind: extensionKindToDefinitionKind[extension.kind],
      name: extension.name,
    } as TypeDefinitionNode);
  }
  return synthesized;
}

function collectDefinedNames(
  definitions: ReadonlyArray<DefinitionNode>,
  into: { directives: Set<string>; types: Set<string> },
) {
  for (const definition of definitions) {
    const name = definitionName(definition);
    if (!name) continue;
    if (definition.kind === Kind.DIRECTIVE_DEFINITION) {
      into.directives.add(name);
    } else if (isTypeDefinitionNode(definition)) {
      into.types.add(name);
    }
  }
}

function federationMachinery({
  queryRootName,
  queryTypeIsDefined,
  entityTypeNames,
  alreadyDefined,
}: {
  queryRootName: string;
  queryTypeIsDefined: boolean;
  entityTypeNames: string[];
  alreadyDefined: Set<string>;
}): DefinitionNode[] {
  const hasEntities = entityTypeNames.length > 0;

  const parts: string[] = [];
  if (!alreadyDefined.has(SERVICE_TYPE_NAME)) {
    parts.push(`type ${SERVICE_TYPE_NAME} {\n  sdl: String\n}`);
  }
  if (hasEntities) {
    if (!alreadyDefined.has(ANY_TYPE_NAME)) {
      parts.push(`scalar ${ANY_TYPE_NAME}`);
    }
    if (!alreadyDefined.has(ENTITY_TYPE_NAME)) {
      parts.push(`union ${ENTITY_TYPE_NAME} = ${entityTypeNames.join(' | ')}`);
    }
  }

  const rootFields = [
    hasEntities
      ? `  ${ENTITIES_FIELD_NAME}(${REPRESENTATIONS_ARGUMENT_NAME}: [${ANY_TYPE_NAME}!]!): [${ENTITY_TYPE_NAME}]!`
      : undefined,
    `  ${SERVICE_FIELD_NAME}: ${SERVICE_TYPE_NAME}!`,
  ].filter((field): field is string => field !== undefined);

  parts.push(
    `${queryTypeIsDefined ? 'extend type' : 'type'} ${queryRootName} {\n${rootFields.join(
      '\n',
    )}\n}`,
  );

  return [...parse(parts.join('\n\n'), { noLocation: true }).definitions];
}

/**
 * Assembles a complete subgraph document from a user's type definitions.
 *
 * This is where the federation contribution lives: the specification
 * definitions the schema `@link`s, the `_Any` / `_Entity` / `_Service` types and
 * the `_entities` / `_service` root fields. Everything else — parsing,
 * validation, schema construction — is left to `graphql-js`.
 */
function buildSubgraph(inputDocument: DocumentNode): Subgraph {
  const userDocument = inputDocument;

  const link = findFederationLink(userDocument);
  const isFederation2 = link !== null;

  const definedDirectives = new Set<string>();
  const definedTypes = new Set<string>();
  collectDefinedNames(userDocument.definitions, {
    directives: definedDirectives,
    types: definedTypes,
  });

  // Specification definitions, under the names this schema gives them.
  const specDefinitions: DefinitionNode[] = [];
  const specNames = { directives: new Set<string>(), types: new Set<string>() };

  if (link) {
    const linkSpec = applyLinkNaming(
      linkSpecDocument(),
      new Map([['@link', '@link']]),
      LINK_NAMESPACE,
    );
    const federationSpec = applyLinkNaming(
      federationSpecDocument(link.version),
      link.imports,
      FEDERATION_NAMESPACE,
    );
    specDefinitions.push(
      ...linkSpec.definitions,
      ...federationSpec.definitions,
    );
  } else {
    // Federation 1: no `@link`, so nothing is namespaced or renamed.
    specDefinitions.push(...federation1SpecDocument().definitions);
    if (hasLinkDirective(userDocument)) {
      // A `@link` to some non-federation specification still needs `@link` itself.
      specDefinitions.push(...linkSpecDocument().definitions);
    }
  }

  collectDefinedNames(specDefinitions, specNames);

  // Only contribute what the schema has not already declared for itself.
  const injectedSpecDefinitions = specDefinitions.filter((definition) => {
    const name = definitionName(definition);
    if (!name) return false;
    return definition.kind === Kind.DIRECTIVE_DEFINITION
      ? !definedDirectives.has(name)
      : !definedTypes.has(name);
  });

  const keyDirectiveName = link
    ? linkedDirectiveName(link.imports, FEDERATION_NAMESPACE, 'key')
    : 'key';

  const synthesizedDefinitions = synthesizeMissingDefinitions(userDocument);
  const queryRootName = findQueryRootName(userDocument);
  const entityTypeNames = findEntityTypeNames(userDocument, keyDirectiveName);

  const machineryDefinitions = federationMachinery({
    queryRootName,
    queryTypeIsDefined:
      definedTypes.has(queryRootName) ||
      synthesizedDefinitions.some((d) => d.name.value === queryRootName),
    entityTypeNames,
    alreadyDefined: definedTypes,
  });

  const document: DocumentNode = {
    kind: Kind.DOCUMENT,
    definitions: [
      ...userDocument.definitions,
      ...synthesizedDefinitions,
      ...injectedSpecDefinitions,
      ...machineryDefinitions,
    ],
  };

  const federationElementNames: FederationElementNames = {
    directives: [...specNames.directives],
    types: [
      ...specNames.types,
      SERVICE_TYPE_NAME,
      ANY_TYPE_NAME,
      ENTITY_TYPE_NAME,
    ],
  };

  // Federation 2 composition reads a subgraph's `@link`s to interpret it, so the
  // whole assembled document is published. Federation 1 composition predates
  // `@link` and fails if a subgraph declares the federation directives itself,
  // so those are held back for it.
  const serviceSdl = () =>
    printDefinitions(
      isFederation2
        ? document.definitions
        : withoutFederationElements(
            [...userDocument.definitions, ...synthesizedDefinitions],
            federationElementNames,
          ),
    );

  return {
    document,
    serviceSdl,
    queryRootName,
    entityTypeNames,
    isFederation2,
  };
}

function withoutFederationElements(
  definitions: ReadonlyArray<DefinitionNode>,
  federationElementNames: FederationElementNames,
): DefinitionNode[] {
  return definitions.filter((definition) => {
    if (definition.kind === Kind.DIRECTIVE_DEFINITION) {
      return !federationElementNames.directives.includes(definition.name.value);
    }
    if (isTypeDefinitionNode(definition) || isTypeExtensionNode(definition)) {
      return !federationElementNames.types.includes(definition.name.value);
    }
    return true;
  });
}

function printDefinitions(definitions: ReadonlyArray<DefinitionNode>): string {
  return print({ kind: Kind.DOCUMENT, definitions });
}
