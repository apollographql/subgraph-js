import { ASTNode, GraphQLError, print } from 'graphql';
import {
  EARLIEST_CONNECT_VERSION,
  LATEST_CONNECT_VERSION,
  LATEST_FEDERATION_VERSION,
  printVersion,
} from './specs';

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

export class MultipleConnectLinksError extends FederationError {
  constructor(links: ReadonlyArray<ASTNode>) {
    super(
      `Schema links the connect specification more than once. Only a single ` +
        `@link to https://specs.apollo.dev/connect is allowed, found:\n` +
        links.map((link) => `\t${print(link)}`).join('\n'),
    );
  }
}

export class UnsupportedConnectVersionError extends FederationError {
  constructor(url: string) {
    super(
      `Unsupported connect version linked from "${url}". Expected a URL of the ` +
        `form https://specs.apollo.dev/connect/v0.x, from ` +
        `${printVersion(EARLIEST_CONNECT_VERSION)} up to ` +
        `${printVersion(LATEST_CONNECT_VERSION)}.`,
    );
  }
}

export class UnsupportedLinkImportError extends FederationError {
  constructor(message: string) {
    super(message);
  }

  /** `specification` names what was linked, e.g. `federation specification v2.5`. */
  static unknownName(
    name: string,
    specification: string,
  ): UnsupportedLinkImportError {
    return new UnsupportedLinkImportError(
      `Cannot import "${name}": it is not part of the ${specification}.`,
    );
  }

  static malformed(node: ASTNode): UnsupportedLinkImportError {
    return new UnsupportedLinkImportError(
      `Invalid @link import ${print(node)}. Imports must be a string ("@key") or an ` +
        `object with a name and an optional alias ({ name: "@key", as: "@primaryKey" }).`,
    );
  }
}
