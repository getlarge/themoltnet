# Nx Release Workflow Notes

This is a temporary contributor note until the documentation IA is reorganized.
It records how this branch expects Nx release to be used.

## Intent

Nx release should replace release-please as the release orchestration layer.
The goal is to let the Nx project graph and release groups decide ordering,
dependency bumps, changelog/tag generation, Docker image tagging, and Go module
dependency propagation.

Release-please remains the historical workflow until the migration lands. Do
not update release-please configuration for new release behavior on this branch
unless the migration is being rolled back.

## Release Groups

Configured in `nx.json` under `release.groups`:

- `npm-packages`: independent published TypeScript packages.
- `cli`: fixed-version CLI family, including the Go CLI and npm wrapper
  packages.
- `go-modules`: independent Go library modules.
- `github-actions`: independent GitHub Actions distributed from this repo by
  tag.
- `docker-images`: independent Docker images built from Nx projects with
  Dockerfiles.

Use groups when invoking release commands. Avoid hand-ordering projects; Nx
should derive project ordering and dependent updates.

## Dry Runs

Use dry-runs before changing release config:

```bash
pnpm exec nx release version patch --groups npm-packages --dry-run --verbose
pnpm exec nx release version patch --groups go-modules,cli --dry-run --verbose
pnpm exec nx release version patch --groups github-actions --dry-run --verbose
NX_DRY_RUN=true pnpm exec nx release version patch --groups docker-images --dry-run --verbose
```

The Docker dry-run sets `NX_DRY_RUN=true` because `docker.preVersionCommand`
would otherwise build images before Nx retags them.

## Go Modules

Go modules use `tools/src/release/go-version-actions.ts`.

Current behavior:

- Current Go project versions come from git tags, not `go.mod`.
- Public Go module lookup can use GOPROXY-compatible `@latest` responses.
- `GOPROXY=direct` or `off` disables proxy lookup; use git tags for private or
  direct-only modules.
- Go dependency updates are written to `go.mod` through Nx's release tree.
- After versioning, configured validation roots run:

```bash
GOWORK=off GOPROXY=direct go mod tidy
GOWORK=off GOPROXY=direct go build ./...
```

`GOWORK=off` is intentional for release validation. The released module should
resolve from module versions and replace directives exactly as a consumer would,
not from the local `go.work` workspace.

The generic Go version action must not contain MoltNet-specific project names or
paths. Repository-specific validation groups, projects, roots, and GOPROXY live
in `nx.json` `release.version.versionActionsOptions`.

## Go CLI Artifacts

The Go CLI release artifact step is owned by the `moltnet-cli:nx-release-publish`
target. It calls `tools/src/release/go-artifact-publisher.cli.ts` with
`apps/moltnet-cli/nx-release-artifacts.json`.

That config is the local shape we want to extract into a generic Nx Go release
plugin:

- Build a GOOS/GOARCH matrix with `GOWORK=off` and `CGO_ENABLED=0`.
- Inject `{version}` and `{shortCommit}` into Go ldflags.
- Archive Unix binaries as `.tar.gz` and Windows binaries as `.zip`.
- Write `checksums.txt` in sha256sum-compatible format.
- Stage binaries into the npm platform packages before npm publishing.
- Upload archives and checksums to the configurable artifact store.

The six npm platform packages declare `implicitDependencies` on `moltnet-cli`.
Their generated `nx-release-publish` targets depend on `^nx-release-publish`,
so Nx runs `moltnet-cli:nx-release-publish` before publishing those packages.

The only artifact store currently implemented is GitHub Releases:

```json
{
  "artifactStore": {
    "finalize": false,
    "provider": "github",
    "releaseTag": "cli-v{version}",
    "upload": true
  }
}
```

Use `provider: "none"` when testing a different publisher or when a downstream
CI job owns upload. Homebrew/cask publishing is intentionally out of scope for
the first Nx-native CLI release.

Dry-run the artifact step after `nx release version --dry-run`:

```bash
pnpm exec nx run moltnet-cli:nx-release-publish -- --dry-run --verbose
```

Build archives and stage npm package binaries locally without uploading:

```bash
pnpm exec nx run moltnet-cli:nx-release-publish -- --skip-upload --verbose
```

## GitHub Actions

The agent daemon action is semvered by the `github-actions` release group.
It is not published to npm; consumers load it from this repository with
path-based GitHub Action syntax:

```yaml
uses: getlarge/themoltnet/packages/agent-daemon-action@v0
```

Nx creates the immutable semver tag:

```text
agent-daemon-action-v{version}
```

The action's `nx-release-publish` target validates that
`packages/agent-daemon-action/dist/main.js` is committed, then moves the stable
major tag (`v0`, later `v1`) to the release commit. Rebuild the committed bundle
through Nx:

```bash
pnpm exec nx run @themoltnet/agent-daemon-action:build
```

Do not use `pnpm --filter` for action build/test/typecheck tasks.

## Docker Images

Docker releases use Nx native Docker release support. The `docker-images`
release group owns the Docker pre-version helper, so image builds only run when
that group is selected. The helper builds the group before Nx retags images. By
default it reads the project list from `nx.json`.

Override the image list only for local debugging:

```bash
NX_RELEASE_DOCKER_PROJECTS=@moltnet/rest-api pnpm exec nx release version patch --groups docker-images --dry-run --verbose
```

## Expected Operator Flow

1. Confirm release groups and tag patterns in `nx.json`.
2. Run a dry-run for the affected group or groups.
3. Inspect planned file changes, tags, and Go validation commands.
4. Run focused tests for any changed release helpers.
5. Only then run the non-dry release command.

Do not manually edit generated changelogs, release tags, or dependent version
bumps unless Nx release output is wrong and the release helper/config is being
fixed in the same change.
