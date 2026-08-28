# Compatibility

Runs the [Apollo Federation subgraph compatibility suite](https://github.com/apollographql/apollo-federation-subgraph-compatibility)
against `@apollo/subgraph`, using Apollo Server to serve the subgraph.

The suite composes a supergraph from this subgraph plus two reference subgraphs,
runs a router against it, and checks each federation feature end to end. It is
the closest thing to a real integration test this library has: `_service { sdl }`
has to be something composition accepts, and entity resolution has to work
through an actual router.

`schema.graphql` and the fixture data in `src/data.ts` are fixed by the suite —
it asserts on the values — so they mirror the reference implementations, and
`federation-jvm`'s in particular.

## Running

Containers are run with [podman](https://podman.io). The suite calls
`docker compose` directly, with no way to configure the binary, so
[`scripts/docker`](./scripts/docker) forwards those calls to podman — the compose
format and subcommands are the same. The `compatibility` script puts that
directory on `PATH`; nothing else is needed, and no docker installation is
involved.

```sh
npm install          # from the repository root
npm run build        # build the library
cd compatibility
npm install
npm run compatibility
```

Make sure a podman machine is running first (`podman machine start` on macOS).
Results are written to `results.md`.

To run under docker instead, drop the `PATH=` prefix from the `compatibility`
script; `compose.yaml` and the `Dockerfile` are the same either way.

### Running the subgraph outside a container

Build and start the subgraph locally, then point the suite at it. The router and
reference subgraphs still run as containers. Useful when iterating on the
library, as it skips the image build.

```sh
cd compatibility
npm run build
npm run start &
npm run compatibility:local
```

## Current results

All 15 features pass.

| Federation 1 | Federation 2 |
| --- | --- |
| `_service` 🟢 | `@link` 🟢 |
| `@key` (single) 🟢 | `@shareable` 🟢 |
| `@key` (multi) 🟢 | `@tag` 🟢 |
| `@key` (composite) 🟢 | `@override` 🟢 |
| repeatable `@key` 🟢 | `@inaccessible` 🟢 |
| `@requires` 🟢 | `@composeDirective` 🟢 |
| `@provides` 🟢 | `@interfaceObject` 🟢 |
| federated tracing 🟢 | |

Federated tracing comes from Apollo Server, which enables
`ApolloServerPluginInlineTrace` on its own once it sees a subgraph schema.
