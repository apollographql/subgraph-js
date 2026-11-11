/**
 * `@link` handling: finding the federation link in a subgraph document, reading
 * its `import` list, and applying the resulting naming to the specification
 * definitions this library injects.
 */
import {
  ConstDirectiveNode,
  ConstValueNode,
  DocumentNode,
  Kind,
  specifiedScalarTypes,
  visit,
} from 'graphql';
import {
  MultipleFederationLinksError,
  UnsupportedFederationVersionError,
  UnsupportedLinkImportError,
} from './errors';
import {
  FEDERATION_SPEC_IDENTITY,
  LATEST_FEDERATION_VERSION,
  LINK_SPEC_IDENTITY,
  SpecVersion,
  federationSpecDocument,
  linkSpecDocument,
  importableNames,
  printVersion,
  versionCode,
} from './specs';

const LINK_DIRECTIVE_NAME = 'link';

export const FEDERATION_NAMESPACE = 'federation';
export const LINK_NAMESPACE = 'link';

/** A schema's `@link` to one of the specifications this library knows. */
export interface SpecLink {
  url: string;
  version: SpecVersion;
  /**
   * Prefix given to elements that are not explicitly imported: the `as`
   * argument of the `@link`, or the specification's own name.
   */
  namespace: string;
  /**
   * Maps a canonical specification name to the name it takes in this schema.
   * Directives are keyed with their leading `@`, as they are written in `import`.
   * Only explicitly imported elements appear here; everything else is namespaced.
   */
  imports: Map<string, string>;
  /** `@link` directive definition application */
  node: ConstDirectiveNode;
}

export type FederationLink = SpecLink;

function schemaLevelDirectives(document: DocumentNode): ConstDirectiveNode[] {
  const directives: ConstDirectiveNode[] = [];
  for (const definition of document.definitions) {
    if (
      definition.kind === Kind.SCHEMA_DEFINITION ||
      definition.kind === Kind.SCHEMA_EXTENSION
    ) {
      directives.push(...(definition.directives ?? []));
    }
  }
  return directives;
}

function stringArgument(
  directive: ConstDirectiveNode,
  name: string,
): string | undefined {
  const argument = directive.arguments?.find((arg) => arg.name.value === name);
  return argument?.value.kind === Kind.STRING
    ? argument.value.value
    : undefined;
}

/** True if the document declares any `@link`, federation-related or not. */
export function hasLinkDirective(document: DocumentNode): boolean {
  return schemaLevelDirectives(document).some(
    (directive) => directive.name.value === LINK_DIRECTIVE_NAME,
  );
}

/**
 * Every schema-level `@link` whose `url` points at the specification `identity`.
 *
 * As in composition, the last path segment of a `url` is the version and the one
 * before it is the specification name, so only the version may follow the
 * identity: `https://specs.apollo.dev/federation/extra/v2.9` links a custom
 * specification named `extra`, not federation. A trailing slash is still
 * matched, so that a malformed version (`.../federation/v2.9/`) is reported
 * against this specification rather than silently ignored.
 */
function linksTo(
  document: DocumentNode,
  identity: string,
): ConstDirectiveNode[] {
  return schemaLevelDirectives(document).filter((directive) => {
    if (directive.name.value !== LINK_DIRECTIVE_NAME) return false;
    const url = stringArgument(directive, 'url');
    if (url === undefined || !url.startsWith(`${identity}/`)) return false;
    return /^[^/]*\/?$/.test(url.slice(identity.length + 1));
  });
}

/** Reads the `vX.Y` version following `identity` in a specification `url`. */
function parseVersion(url: string, identity: string): SpecVersion | null {
  const match = /^v(\d+)\.(\d+)$/.exec(url.slice(identity.length + 1));
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

function specLink(
  node: ConstDirectiveNode,
  version: SpecVersion,
  defaultNamespace: string,
  specDocument: DocumentNode,
  specification: string,
): SpecLink {
  // Callers only pass links whose `url` matched, so it is present.
  const url = stringArgument(node, 'url')!;
  const imports = parseImports(
    node,
    importableNames(specDocument),
    `${specification} ${printVersion(version)}`,
  );
  const namespace = stringArgument(node, 'as') ?? defaultNamespace;
  return { url, version, namespace, imports, node };
}

/**
 * Finds the `@link` pointing at the federation specification, if any. A document
 * without one is treated as a Federation 1 subgraph.
 */
export function findFederationLink(
  document: DocumentNode,
): FederationLink | null {
  const links = linksTo(document, FEDERATION_SPEC_IDENTITY);
  if (links.length === 0) return null;
  if (links.length > 1) throw new MultipleFederationLinksError(links);

  const node = links[0];
  const url = stringArgument(node, 'url')!;
  const version = parseVersion(url, FEDERATION_SPEC_IDENTITY);
  if (
    !version ||
    version.major !== LATEST_FEDERATION_VERSION.major ||
    versionCode(version) > versionCode(LATEST_FEDERATION_VERSION)
  ) {
    throw new UnsupportedFederationVersionError(url);
  }

  return specLink(
    node,
    version,
    FEDERATION_NAMESPACE,
    federationSpecDocument(version),
    'federation specification',
  );
}

/**
 * The names the link specification's own elements take in this schema. `@link`
 * itself is never renamed, but `Import` and `Purpose` follow the `import` list of
 * the schema's `@link(url: "https://specs.apollo.dev/link/v1.0")`, if any, and
 * are otherwise namespaced (`link__Import`).
 */
export function findLinkSpecImports(
  document: DocumentNode,
): Map<string, string> {
  const imports = new Map([['@link', '@link']]);
  const [bootstrap] = linksTo(document, LINK_SPEC_IDENTITY);
  if (!bootstrap) return imports;

  const version = parseVersion(
    stringArgument(bootstrap, 'url')!,
    LINK_SPEC_IDENTITY,
  );
  const specification = version
    ? `link specification ${printVersion(version)}`
    : 'link specification';
  for (const [name, alias] of parseImports(
    bootstrap,
    importableNames(linkSpecDocument()),
    specification,
  )) {
    if (name !== '@link') imports.set(name, alias);
  }
  return imports;
}

function parseImports(
  link: ConstDirectiveNode,
  importable: Set<string>,
  specification: string,
): Map<string, string> {
  const imports = new Map<string, string>();
  const importArgument = link.arguments?.find(
    (arg) => arg.name.value === 'import',
  );
  if (!importArgument) return imports;
  if (importArgument.value.kind !== Kind.LIST) {
    throw UnsupportedLinkImportError.malformed(importArgument.value);
  }

  for (const entry of importArgument.value.values) {
    const { name, alias } = parseImportEntry(entry);
    if (!importable.has(name)) {
      throw UnsupportedLinkImportError.unknownName(name, specification);
    }
    imports.set(name, alias);
  }
  return imports;
}

function parseImportEntry(entry: ConstValueNode): {
  name: string;
  alias: string;
} {
  if (entry.kind === Kind.STRING) {
    return { name: entry.value, alias: entry.value };
  }

  if (entry.kind === Kind.OBJECT) {
    const field = (fieldName: string) => {
      const found = entry.fields.find((f) => f.name.value === fieldName);
      if (!found) return undefined;
      if (found.value.kind !== Kind.STRING) {
        throw UnsupportedLinkImportError.malformed(entry);
      }
      return found.value.value;
    };

    const name = field('name');
    if (!name) throw UnsupportedLinkImportError.malformed(entry);
    return { name, alias: field('as') ?? name };
  }

  throw UnsupportedLinkImportError.malformed(entry);
}

/**
 * The name a canonical specification element takes in this schema: its alias if
 * it was imported, otherwise the namespaced form (`@key` -> `@federation__key`).
 */
export function linkedName(
  imports: Map<string, string>,
  namespace: string,
  canonical: string,
): string {
  const alias = imports.get(canonical);
  if (alias) return alias;
  return canonical.startsWith('@')
    ? `@${namespace}__${canonical.slice(1)}`
    : `${namespace}__${canonical}`;
}

/** Same as {@link linkedName}, but for a directive, and without the leading `@`. */
export function linkedDirectiveName(
  imports: Map<string, string>,
  namespace: string,
  canonicalWithoutAt: string,
): string {
  return linkedName(imports, namespace, `@${canonicalWithoutAt}`).slice(1);
}

/**
 * Rewrites a specification document so every definition it contains carries the
 * name it takes in the target schema. Only definition names and type references
 * are renamed — argument names, enum values and descriptions are left alone.
 */
export function applyLinkNaming(
  document: DocumentNode,
  imports: Map<string, string>,
  namespace: string,
): DocumentNode {
  const rename = (canonical: string) =>
    linkedName(imports, namespace, canonical);

  return visit(document, {
    DirectiveDefinition(node) {
      const renamed = rename(`@${node.name.value}`).slice(1);
      return { ...node, name: { ...node.name, value: renamed } };
    },
    ScalarTypeDefinition(node) {
      return {
        ...node,
        name: { ...node.name, value: rename(node.name.value) },
      };
    },
    EnumTypeDefinition(node) {
      return {
        ...node,
        name: { ...node.name, value: rename(node.name.value) },
      };
    },
    NamedType(node) {
      if (specifiedScalarTypes.some((type) => type.name === node.name.value))
        return undefined;
      return {
        ...node,
        name: { ...node.name, value: rename(node.name.value) },
      };
    },
  });
}
