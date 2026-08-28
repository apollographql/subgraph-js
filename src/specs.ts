/**
 * The Apollo Federation and `@link` specification definitions.
 *
 * This module is the only place in the library that knows what the federation
 * specification contains. Everything else works with plain `graphql-js` AST and
 * schema objects.
 *
 * The definitions are kept as one entry per SDL definition, tagged with the
 * federation version range they apply to, rather than as one file per
 * federation version. A `@link(url: ".../federation/v2.x")` then resolves to
 * the subset of entries covering that version.
 */
import { DocumentNode, Kind, parse } from 'graphql';

export const FEDERATION_SPEC_IDENTITY = 'https://specs.apollo.dev/federation';
export const LINK_SPEC_IDENTITY = 'https://specs.apollo.dev/link';

export interface SpecVersion {
  major: number;
  minor: number;
}

/** Encodes a version as a single comparable integer (2.10 -> 210). */
export function versionCode({ major, minor }: SpecVersion): number {
  return major * 100 + minor;
}

export function printVersion({ major, minor }: SpecVersion): string {
  return `v${major}.${minor}`;
}

/** The most recent federation version this library knows how to link against. */
export const LATEST_FEDERATION_VERSION: SpecVersion = { major: 2, minor: 15 };

const version = (major: number, minor: number) => versionCode({ major, minor });

interface VersionedDefinition {
  /** First federation version containing this definition. */
  since: number;
  /** Last federation version containing this definition, if it was later replaced. */
  until?: number;
  sdl: string;
}

const TAG_LOCATIONS =
  'FIELD_DEFINITION | INTERFACE | OBJECT | UNION | ARGUMENT_DEFINITION | SCALAR | ENUM | ENUM_VALUE | INPUT_OBJECT | INPUT_FIELD_DEFINITION';

const SCOPED_LOCATIONS =
  'FIELD_DEFINITION | OBJECT | INTERFACE | SCALAR | ENUM';

/**
 * All Apollo Federation type and directive definitions.
 *
 * @see {@link https://www.apollographql.com/docs/graphos/schema-design/federated-schemas/reference/directives Apollo Federation} for details.
 */
const FEDERATION_DEFINITIONS: VersionedDefinition[] = [
  { since: version(2, 0), sdl: `scalar FieldSet` },
  {
    since: version(2, 0),
    sdl: `directive @key(fields: FieldSet!, resolvable: Boolean = true) repeatable on OBJECT | INTERFACE`,
  },
  {
    since: version(2, 0),
    sdl: `directive @requires(fields: FieldSet!) on FIELD_DEFINITION`,
  },
  {
    since: version(2, 0),
    sdl: `directive @provides(fields: FieldSet!) on FIELD_DEFINITION`,
  },
  {
    since: version(2, 0),
    sdl: `directive @external on OBJECT | FIELD_DEFINITION`,
  },
  { since: version(2, 0), sdl: `directive @extends on OBJECT | INTERFACE` },
  {
    since: version(2, 0),
    sdl: `directive @inaccessible on FIELD_DEFINITION | OBJECT | INTERFACE | UNION | ARGUMENT_DEFINITION | SCALAR | ENUM | ENUM_VALUE | INPUT_OBJECT | INPUT_FIELD_DEFINITION`,
  },

  // `@shareable` became repeatable in federation v2.2.
  {
    since: version(2, 0),
    until: version(2, 1),
    sdl: `directive @shareable on OBJECT | FIELD_DEFINITION`,
  },
  {
    since: version(2, 2),
    sdl: `directive @shareable repeatable on OBJECT | FIELD_DEFINITION`,
  },

  // `@override` gained the `label` argument in v2.7 (progressive override).
  {
    since: version(2, 0),
    until: version(2, 6),
    sdl: `directive @override(from: String!) on FIELD_DEFINITION`,
  },
  {
    since: version(2, 7),
    sdl: `directive @override(from: String!, label: String) on FIELD_DEFINITION`,
  },

  // `@tag` gained the SCHEMA location in v2.3 (tag spec v0.3).
  {
    since: version(2, 0),
    until: version(2, 2),
    sdl: `directive @tag(name: String!) repeatable on ${TAG_LOCATIONS}`,
  },
  {
    since: version(2, 3),
    sdl: `directive @tag(name: String!) repeatable on ${TAG_LOCATIONS} | SCHEMA`,
  },

  {
    since: version(2, 1),
    sdl: `directive @composeDirective(name: String) repeatable on SCHEMA`,
  },

  { since: version(2, 3), sdl: `directive @interfaceObject on OBJECT` },

  { since: version(2, 5), sdl: `scalar Scope` },
  {
    since: version(2, 5),
    sdl: `directive @authenticated on ${SCOPED_LOCATIONS}`,
  },
  {
    since: version(2, 5),
    sdl: `directive @requiresScopes(scopes: [[Scope!]!]!) on ${SCOPED_LOCATIONS}`,
  },

  { since: version(2, 6), sdl: `scalar Policy` },
  {
    since: version(2, 6),
    sdl: `directive @policy(policies: [[Policy!]!]!) on ${SCOPED_LOCATIONS}`,
  },

  { since: version(2, 8), sdl: `scalar ContextFieldValue` },
  {
    since: version(2, 8),
    sdl: `directive @context(name: String!) repeatable on INTERFACE | OBJECT | UNION`,
  },
  {
    since: version(2, 8),
    sdl: `directive @fromContext(field: ContextFieldValue) on ARGUMENT_DEFINITION`,
  },

  {
    since: version(2, 9),
    sdl: `directive @cost(weight: Int!) on ARGUMENT_DEFINITION | ENUM | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | OBJECT | SCALAR`,
  },
  {
    since: version(2, 9),
    sdl: `directive @listSize(assumedSize: Int, slicingArguments: [String!], sizedFields: [String!], requireOneSlicingArgument: Boolean = true) on FIELD_DEFINITION`,
  },

  {
    since: version(2, 12),
    sdl: `directive @cacheTag(format: String!) repeatable on OBJECT | FIELD_DEFINITION`,
  },
];

/**
 * The `@link` specification, `https://specs.apollo.dev/link/v1.0`. Bootstrapped
 * into every Federation 2 subgraph: a schema cannot declare its `@link`s without
 * it.
 */
const LINK_SPEC_SDL = `
directive @link(url: String, as: String, for: Purpose, import: [Import]) repeatable on SCHEMA

scalar Import

enum Purpose {
  """
  \`SECURITY\` features provide metadata necessary to securely resolve fields.
  """
  SECURITY

  """
  \`EXECUTION\` features provide metadata necessary for operation execution.
  """
  EXECUTION
}
`;

/**
 * Definitions injected into a Federation 1 subgraph — one that never `@link`s
 * the federation specification. There is no `@link`, so nothing is namespaced
 * and nothing can be renamed.
 */
const FEDERATION_1_SDL = `
scalar _FieldSet

directive @key(fields: _FieldSet!) repeatable on OBJECT | INTERFACE

directive @requires(fields: _FieldSet!) on FIELD_DEFINITION

directive @provides(fields: _FieldSet!) on FIELD_DEFINITION

directive @external on FIELD_DEFINITION

directive @extends on OBJECT | INTERFACE

directive @tag(name: String!) repeatable on ${TAG_LOCATIONS}
`;

function documentFrom(sdl: string): DocumentNode {
  return parse(sdl, { noLocation: true });
}

const federationDocumentCache = new Map<number, DocumentNode>();

/**
 * The federation specification definitions for `version`, under their canonical
 * (unnamespaced, unrenamed) names. Callers apply `@link` naming afterwards.
 */
export function federationSpecDocument(version: SpecVersion): DocumentNode {
  const code = versionCode(version);
  const cached = federationDocumentCache.get(code);
  if (cached) return cached;

  const sdl = FEDERATION_DEFINITIONS.filter(
    (definition) =>
      definition.since <= code && (definition.until ?? Infinity) >= code,
  )
    .map((definition) => definition.sdl)
    .join('\n\n');

  const document = documentFrom(sdl);
  federationDocumentCache.set(code, document);
  return document;
}

let linkDocument: DocumentNode | undefined;

export function linkSpecDocument(): DocumentNode {
  return (linkDocument ??= documentFrom(LINK_SPEC_SDL));
}

let federation1Document: DocumentNode | undefined;

export function federation1SpecDocument(): DocumentNode {
  return (federation1Document ??= documentFrom(FEDERATION_1_SDL));
}

/**
 * The names a `@link(import: [...])` may legally reference for `version`.
 * Directives are keyed with their leading `@`, matching the `import` syntax.
 */
export function importableNames(version: SpecVersion): Set<string> {
  const names = new Set<string>();
  for (const definition of federationSpecDocument(version).definitions) {
    switch (definition.kind) {
      case Kind.DIRECTIVE_DEFINITION:
        names.add(`@${definition.name.value}`);
        break;
      case Kind.SCALAR_TYPE_DEFINITION:
      case Kind.ENUM_TYPE_DEFINITION:
      case Kind.OBJECT_TYPE_DEFINITION:
      case Kind.INPUT_OBJECT_TYPE_DEFINITION:
        names.add(definition.name.value);
        break;
      default:
        break;
    }
  }
  return names;
}
