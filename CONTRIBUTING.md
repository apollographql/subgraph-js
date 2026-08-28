# Contributing to @apollo/subgraph

The Apollo team welcomes contributions of all kinds, including bug reports, documentation, test cases, bug fixes, and features. There are just a few guidelines you need to follow which are described in detail below.

If you want to discuss the project or just say hi, stop by [the Apollo community forums](https://community.apollographql.com/).

## Workflow

We love Github issues! Before working on any new features, please open an issue so that we can agree on the direction, and hopefully avoid investing a lot of time on a feature that might need reworking.

Small pull requests for things like typos, bugfixes, etc are always welcome.

Please note that we will not accept pull requests for style changes.

### Fork this repo

You should create a fork of this project in your account and work from there. You can create a fork by clicking the fork button in GitHub.

### One feature, one branch

Work for each new feature/issue should occur in its own branch. To create a new branch from the command line:

```shell
git checkout -b my-new-feature
```
where "my-new-feature" describes what you're working on.

### Verify your changes locally

You can use npm to build, typecheck and format-check from the root directory

```shell
npm install
npm run build
npm run typecheck
npm run format:check
```

`npm run format` applies any formatting fixes. These same checks, plus the test
suite, run in [Continuous Integration](./.github/workflows/build.yml) on every
pull request.

### Add tests for any bug fixes or new functionality

#### Unit Tests

We are using [Jest](https://jestjs.io/) as our main testing library. This ensures we have good code coverage and can easily test all cases of schema federation.

To run tests:

```shell
npm test
```

#### Compatibility suite

The [`compatibility/`](./compatibility) workspace runs the [Apollo Federation subgraph compatibility suite](https://github.com/apollographql/apollo-federation-subgraph-compatibility) against this library. Any change touching schema assembly, entity resolution, or SDL printing should be verified against it before merging:

```shell
npm run compatibility --workspace @apollo/subgraph-compatibility
```

See the [compatibility README](./compatibility/README.md) for setup (a running podman or docker machine is required) and current results. This suite also runs in CI, on every pull request and on every push to `main`.

### Add a changeset

This project uses [changesets](https://github.com/changesets/changesets) to version and publish releases. Any pull request that should ship a new version needs a changeset describing the change:

```shell
npx changeset
```

Pick the appropriate semver bump (patch/minor/major) and write a summary aimed at consumers of `@apollo/subgraph` — it becomes the changelog entry. Pull requests that don't affect the published package (docs, CI, internal tooling) don't need one.

### Add documentation for new or updated functionality

Please add appropriate TSDoc comments in the source code and update the [README](./README.md) with any relevant information, particularly around federation version support in [`src/specs.ts`](./src/specs.ts).

### Merging your contribution

Create a new pull request (with appropriate labels) and your code will be reviewed by the maintainers. They will confirm at least the following:

- Tests run successfully (unit, typecheck, format check, compatibility suite)
- A changeset is present when the change affects the published package
- Contribution policy has been followed
- Apollo [CLA](https://contribute.apollographql.com/) is signed

A maintainer will need to sign off on your pull request before it can be merged.

## Releasing

Releases are automated with [changesets](https://github.com/changesets/changesets). Merging a pull request with a changeset onto `main` triggers the [release workflow](./.github/workflows/release.yml), which opens (or updates) a "Version Packages" pull request collecting the pending changesets. Merging that PR publishes the new version to npm and creates the matching GitHub release.

Releases follow [semantic versioning](https://semver.org/); the version bump is derived from the changesets included, not chosen manually.
