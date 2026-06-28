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
- `docker-images`: independent Docker images built from Nx projects with
  Dockerfiles.

Use groups when invoking release commands. Avoid hand-ordering projects; Nx
should derive project ordering and dependent updates.

## Dry Runs

Use dry-runs before changing release config:

```bash
pnpm exec nx release version patch --groups npm-packages --dry-run --verbose
pnpm exec nx release version patch --groups go-modules,cli --dry-run --verbose
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

## Docker Images

Docker releases use Nx native Docker release support. The pre-version helper
builds the `docker-images` group before Nx retags images. By default it reads
the project list from `nx.json`.

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
