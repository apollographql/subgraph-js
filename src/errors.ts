import { ASTNode, GraphQLError, print } from 'graphql';
import { LATEST_FEDERATION_VERSION, printVersion } from './specs';

/** Thrown when the assembled subgraph schema is not a valid GraphQL schema. */
export class GraphQLSchemaValidationError extends Error {
  constructor(public readonly errors: ReadonlyArray<GraphQLError>) {
    super(errors.map((error) => error.message).join('\n\n'));
    this.name = 'GraphQLSchemaValidationError';
  }
}

/** Base class for the (few) federation-specific problems this library reports. */
export class FederationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class MultipleFederationLinksError extends FederationError {
  constructor(links: ReadonlyArray<ASTNode>) {
    super(
      `Schema links the federation specification more than once. Only a single ` +
        `@link to https://specs.apollo.dev/federation is allowed, found:\n` +
        links.map((link) => `\t${print(link)}`).join('\n'),
    );
  }
}

export class UnsupportedFederationVersionError extends FederationError {
  constructor(url: string) {
    super(
      `Unsupported federation version linked from "${url}". Expected a URL of the ` +
        `form https://specs.apollo.dev/federation/v2.x, up to ` +
        `${printVersion(LATEST_FEDERATION_VERSION)}.`,
    );
  }
}

export class UnsupportedLinkImportError extends FederationError {
  constructor(message: string) {
    super(message);
  }

  static unknownName(
    name: string,
    version: string,
  ): UnsupportedLinkImportError {
    return new UnsupportedLinkImportError(
      `Cannot import "${name}": it is not part of the federation specification ${version}.`,
    );
  }

  static malformed(node: ASTNode): UnsupportedLinkImportError {
    return new UnsupportedLinkImportError(
      `Invalid @link import ${print(node)}. Imports must be a string ("@key") or an ` +
        `object with a name and an optional alias ({ name: "@key", as: "@primaryKey" }).`,
    );
  }
}
