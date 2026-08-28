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
  SpecVersion,
  importableNames,
  printVersion,
  versionCode,
} from './specs';

const LINK_DIRECTIVE_NAME = 'link';

export const FEDERATION_NAMESPACE = 'federation';
export const LINK_NAMESPACE = 'link';

export interface FederationLink {
  url: string;
  version: SpecVersion;
  /**
   * Maps a canonical specification name to the name it takes in this schema.
   * Directives are keyed with their leading `@`, as they are written in `import`.
   * Only explicitly imported elements appear here; everything else is namespaced.
   */
  imports: Map<string, string>;
  /** `@link` directive definition application */
  node: ConstDirectiveNode;
}

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
 * Finds the `@link` pointing at the federation specification, if any. A document
 * without one is treated as a Federation 1 subgraph.
 */
export function findFederationLink(
  document: DocumentNode,
): FederationLink | null {
  const links = schemaLevelDirectives(document).filter((directive) => {
    if (directive.name.value !== LINK_DIRECTIVE_NAME) return false;
    const url = stringArgument(directive, 'url');
    return url !== undefined && url.startsWith(`${FEDERATION_SPEC_IDENTITY}/`);
  });

  if (links.length === 0) return null;
  if (links.length > 1) throw new MultipleFederationLinksError(links);

  const node = links[0];
  // `stringArgument` already matched, so `url` is present.
  const url = stringArgument(node, 'url')!;
  const version = parseFederationVersion(url);
  const imports = parseImports(node, version);

  return { url, version, imports, node };
}

function parseFederationVersion(url: string): SpecVersion {
  const match = /\/v(\d+)\.(\d+)\/?$/.exec(url);
  if (!match) throw new UnsupportedFederationVersionError(url);

  const version = { major: Number(match[1]), minor: Number(match[2]) };
  if (
    version.major !== LATEST_FEDERATION_VERSION.major ||
    versionCode(version) > versionCode(LATEST_FEDERATION_VERSION)
  ) {
    throw new UnsupportedFederationVersionError(url);
  }
  return version;
}

function parseImports(
  link: ConstDirectiveNode,
  version: SpecVersion,
): Map<string, string> {
  const imports = new Map<string, string>();
  const importArgument = link.arguments?.find(
    (arg) => arg.name.value === 'import',
  );
  if (!importArgument) return imports;
  if (importArgument.value.kind !== Kind.LIST) {
    throw UnsupportedLinkImportError.malformed(importArgument.value);
  }

  const importable = importableNames(version);

  for (const entry of importArgument.value.values) {
    const { name, alias } = parseImportEntry(entry);
    if (!importable.has(name)) {
      throw UnsupportedLinkImportError.unknownName(name, printVersion(version));
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
