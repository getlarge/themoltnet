# Nx Release Workflow Notes

This is a temporary contributor note until the documentation IA is reorganized.
It records how this branch expects Nx release to be used.

## Intent

Nx release is the release orchestration layer. The goal is to let the Nx project
graph and release groups decide ordering, dependency bumps, changelog/tag
generation, Docker image tagging, and Go module dependency propagation.

Do not add new release-please configuration. The release-please workflow and
manifest were removed when this workflow became authoritative.

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

## Production Workflow

Production releases run from `.github/workflows/release.yml` on every push to
`main` when `.nx/version-plans/*.md` files exist. The workflow scopes commands
to the release groups named by those version plans:

```bash
pnpm exec nx release --groups <plan-groups> --verbose --skip-publish
git push origin HEAD:main --follow-tags --no-verify --atomic
pnpm exec nx release publish --groups <plan-groups> --verbose
```

The workflow also supports a manual `dry-run` dispatch:

```bash
pnpm exec nx release --groups <plan-groups> --dry-run --verbose --skip-publish
```

Important production details:

- The explicit git push happens between versioning and publishing so Go module
  tags are visible to GOPROXY before publish targets run.
- The Go CLI artifact publisher creates the draft `cli-v{version}` GitHub
  Release, uploads archives and checksums, then undrafts it.
- Go module publish targets verify the pushed module tags through
  `GOPROXY=https://proxy.golang.org,direct` with `GOWORK=off`.
- npm packages publish with public access and provenance through npm config
  environment variables plus GitHub Actions OIDC/trusted publishing. The
  workflow must keep `permissions.id-token: write`.
- Docker image publish targets push to GHCR. The workflow must keep
  `permissions.packages: write` and the GHCR login step.
- The workflow passes `--groups` from version plans so a CLI-only release does
  not run Docker image release logic.
- The GitHub Action release target moves the stable major tag, for example
  `v0`, after its bundled `dist/main.js` has been committed by the release.

## Full Rehearsal

A dry-run is useful for a quick config sanity check, but it is not enough to
prove the production release path. This workflow needs at least one full release
rehearsal with cleanup prepared before running the command.

Prefer two rehearsal stages:

1. Local registries: Verdaccio for npm and a local Docker registry for images.
2. Real remote services: npm, GHCR, GitHub releases/assets, and GitHub tags.

The local-registry rehearsal catches most Nx orchestration, build, pack, Docker,
and npm publish failures without publishing public artifacts. It does not prove
GitHub release creation, GitHub release asset upload, npm provenance/OIDC, or
GHCR package permissions.

Run rehearsals from a disposable worktree on a dedicated branch. Do not run them
from the main development worktree:

```bash
git worktree add --detach .worktrees/nx-release-rehearsal origin/main
cd .worktrees/nx-release-rehearsal
pnpm install --frozen-lockfile
pnpm exec nx release patch --verbose --yes
```

This command intentionally exercises real side effects:

- version file writes and Go dependency propagation
- Go validation with `GOWORK=off`
- Docker image build, retag, and push
- project changelog generation
- release commit creation
- annotated git tag creation
- GitHub release creation
- Go CLI archive build and GitHub release asset upload
- npm package publish
- GitHub Action stable major tag movement

Before running it, prepare cleanup for every surface below. If any publish step
gets far enough to create immutable public state, do not pretend the rehearsal
was atomic.

## Local Registry Rehearsal

Start the local release rehearsal services:

```bash
COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.release-local.yaml up -d
```

This starts:

- Verdaccio at `http://localhost:4873` for npm publishes.
- A local Docker registry at `localhost:5001` for Docker image pushes.
- Athens at `http://localhost:3000` for GOPROXY-compatible Go module lookups.

Go modules are not uploaded to Athens like npm packages are uploaded to
Verdaccio. The release surface is still the git tag; the proxy is primed and
verified by resolving the tagged module through `GOPROXY`.

Use a disposable worktree and patch only that worktree so Docker release refs
point to the local registry and Go validation resolves through the local proxy:

```bash
git worktree add --detach .worktrees/nx-release-local-registry origin/main
cd .worktrees/nx-release-local-registry
pnpm install --frozen-lockfile
node -e "const fs=require('node:fs'); const nx=JSON.parse(fs.readFileSync('nx.json','utf8')); nx.release.docker.registryUrl='localhost:5001'; nx.release.version.versionActionsOptions.goReleaseGoproxy='http://localhost:3000,direct'; fs.writeFileSync('nx.json', JSON.stringify(nx, null, 2) + '\n')"
mkdir -p tmp/npm-cache
export NPM_CONFIG_CACHE="$PWD/tmp/npm-cache"
export GOPROXY="http://localhost:3000,direct"
```

Run the top-level release command for versioning and changelog generation, then
run publish separately. Top-level `nx release patch` does not expose the npm
`--registry` option, but `nx release publish` does. Nx forwards publish options
to every `nx-release-publish` target, so custom publishers must tolerate generic
publish flags such as `--registry`, `--tag`, `--access`, and `--dryRun`.

```bash
pnpm exec nx release patch --skip-publish --verbose
GO_RELEASE_SKIP_PROXY=true GO_RELEASE_USE_LOCAL_REPLACES=true GITHUB_ACTION_RELEASE_SKIP_PUSH=true pnpm exec nx release publish --verbose --registry http://localhost:4873
```

This publishes npm packages to Verdaccio and Docker images to the local Docker
registry. It still creates local release commits and local tags.

The local Go module publish targets verify that the release tags exist at
`HEAD`, but `GO_RELEASE_SKIP_PROXY=true` skips the GOPROXY lookup because the
local tags have not been pushed to a Git remote visible to Athens. In the real
release, do not set `GO_RELEASE_SKIP_PROXY`; the Go publish targets must verify
the tagged modules through GOPROXY after the release commit and tags are pushed.
`GO_RELEASE_USE_LOCAL_REPLACES=true` is also local-only; it lets the Go CLI
artifact build resolve sibling Go modules from the worktree while the rehearsal
tags are still local-only.
`GITHUB_ACTION_RELEASE_SKIP_PUSH=true` is local-only and prevents the GitHub
Action publisher from moving the stable major tag such as `v0`.

If Verdaccio requires an npm token, create a throwaway local user and write a
root `.npmrc` in the disposable worktree. Nx forwards `--userconfig` to custom
targets, but the inferred npm publish targets do not reliably pass it through to
`pnpm publish`, so use a root `.npmrc` for the rehearsal.

```bash
curl -X PUT http://localhost:4873/-/user/org.couchdb.user:local-release \
  -H 'content-type: application/json' \
  --data '{"name":"local-release","password":"local-release-pass","email":"local-release@example.test","type":"user","roles":[]}'
npm config set //localhost:4873/:_authToken '<token-from-verdaccio>' --userconfig .npmrc
GO_RELEASE_SKIP_PROXY=true GO_RELEASE_USE_LOCAL_REPLACES=true GITHUB_ACTION_RELEASE_SKIP_PUSH=true pnpm exec nx release publish --verbose --registry http://localhost:4873
```

The publish phase may also attempt GitHub release operations depending on the
release changelog/artifact configuration. For the safest local rehearsal,
temporarily set the Go CLI artifact store to `provider: "none"` in
`apps/moltnet-cli/nx-release-artifacts.json`; this still builds archives and
stages npm platform binaries, but skips GitHub release asset upload.

Do not run `nx release changelog patch` as a substitute for the top-level
release command. The direct `changelog` command requires an exact target version
and treats `patch` literally as the version.

Inspect local npm publishes:

```bash
npm view @themoltnet/sdk --registry http://localhost:4873 versions
npm view @themoltnet/cli --registry http://localhost:4873 versions
```

Inspect local Docker publishes:

```bash
curl http://localhost:5001/v2/_catalog
curl http://localhost:5001/v2/getlarge/themoltnet/rest-api/tags/list
```

Prime or inspect local Go proxy resolution after release tags exist:

```bash
GOPROXY=http://localhost:3000,direct GONOSUMDB=github.com/getlarge/themoltnet go list -m github.com/getlarge/themoltnet/libs/moltnet-api-client@vX.Y.Z
GOPROXY=http://localhost:3000,direct GONOSUMDB=github.com/getlarge/themoltnet go list -m github.com/getlarge/themoltnet/libs/dspy-adapters@vX.Y.Z
```

Cleanup local release services:

```bash
COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.release-local.yaml down -v
git worktree remove --force .worktrees/nx-release-local-registry
```

## Rehearsal Cleanup

Capture these values from the rehearsal output:

```bash
RELEASE_COMMIT=<commit-created-by-nx-release>
TAGS='<space-separated-tags-created-by-nx-release>'
DOCKER_TAGS='<space-separated-docker-image-tags>'
NPM_PACKAGES='<space-separated-package@version-values>'
```

Delete local test tags:

```bash
git tag -d $TAGS
```

Delete remote test tags if they were pushed:

```bash
for tag in $TAGS; do
  git push origin ":refs/tags/$tag"
done
```

Delete GitHub releases created for those tags:

```bash
for tag in $TAGS; do
  gh release delete "$tag" --cleanup-tag --yes || true
done
```

Delete GitHub Action stable major tags only if the rehearsal moved them:

```bash
git push origin :refs/tags/v0
```

Remove the rehearsal release commit from the rehearsal branch or discard the
worktree. If it was pushed to a branch, delete the branch instead of reverting
unless a reviewer needs the release commit for audit:

```bash
git worktree remove --force .worktrees/nx-release-rehearsal
git push origin :refs/heads/<rehearsal-branch>
```

Delete local Docker tags:

```bash
for image in \
  ghcr.io/getlarge/themoltnet/console \
  ghcr.io/getlarge/themoltnet/db-migrate \
  ghcr.io/getlarge/themoltnet/landing \
  ghcr.io/getlarge/themoltnet/mcp-host \
  ghcr.io/getlarge/themoltnet/mcp-server \
  ghcr.io/getlarge/themoltnet/rest-api
do
  for tag in $DOCKER_TAGS; do
    docker image rm "$image:$tag" || true
  done
done
```

Delete pushed GHCR package versions from GitHub Packages. There is no simple
`gh release` equivalent for container package cleanup; use the GitHub Packages
UI or API and delete only versions created by the rehearsal.

Unpublish npm packages only if the rehearsal published throwaway versions and
npm still allows unpublish for those package versions. Otherwise deprecate them
as rehearsal artifacts:

```bash
for package_version in $NPM_PACKAGES; do
  npm deprecate "$package_version" "Nx release rehearsal artifact; do not use"
done
```

Remove generated local artifacts if the worktree is kept for inspection:

```bash
rm -rf apps/moltnet-cli/dist/nx-release
git restore .
git clean -fd
```

## Dry Runs

Use dry-runs only as a fast preflight before the full rehearsal:

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
5. Prepare the rehearsal cleanup values and permissions.
6. Run the full non-dry release rehearsal from a disposable worktree.
7. Clean up rehearsal side effects before merging release automation.

Do not manually edit generated changelogs, release tags, or dependent version
bumps unless Nx release output is wrong and the release helper/config is being
fixed in the same change.
