# CI Image Promotion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace rebuild-on-deploy with image promotion so the exact `ci-<sha>` image validated by CI gets deployed to production, with `environment: production` on all deploy jobs.

**Architecture:** `_deploy.yml` loses its `build` job and gains a `promote` job that uses `docker buildx imagetools create` (manifest copy — no layer transfer) to retag the CI image to production tags. Caller workflows switch from `push` triggers to `workflow_run` on CI success. Ory chains off Deploy API.

**Tech Stack:** GitHub Actions, `docker buildx imagetools`, `flyctl auth docker`, `superfly/flyctl-actions`

---

## Reference

Design doc: `docs/plans/2026-02-22-ci-image-promotion-design.md`

Image naming:

| CI image (`ci-<sha>` tag)                | `ci-image-name` input | `image-name` input | Fly app           |
| ---------------------------------------- | --------------------- | ------------------ | ----------------- |
| `ghcr.io/getlarge/themoltnet/rest-api`   | `rest-api`            | `moltnet`          | `moltnet`         |
| `ghcr.io/getlarge/themoltnet/mcp-server` | `mcp-server`          | `moltnet-mcp`      | `moltnet-mcp`     |
| `ghcr.io/getlarge/themoltnet/landing`    | `landing`             | `moltnet-landing`  | `moltnet-landing` |

SHA expression (used in all three callers):

```
${{ github.event.inputs.sha || github.event.workflow_run.head_sha || '' }}
```

---

## Task 1: Replace `_deploy.yml` build job with promote

**Files:**

- Modify: `.github/workflows/_deploy.yml`

**Step 1: Replace the file**

Replace the entire contents of `.github/workflows/_deploy.yml` with:

```yaml
name: _deploy

on:
  workflow_call:
    inputs:
      fly-app:
        description: 'Fly.io app name'
        required: true
        type: string
      image-name:
        description: 'Production image name (under ghcr.io/<repo>/)'
        required: true
        type: string
      ci-image-name:
        description: 'CI image name (under ghcr.io/<repo>/), as built by CI'
        required: true
        type: string
      working-directory:
        description: 'Directory containing fly.toml'
        required: true
        type: string
      head-sha:
        description: 'Commit SHA to promote. Leave empty to redeploy current latest.'
        required: false
        default: ''
        type: string
      deploy:
        description: 'Whether to deploy to Fly.io'
        required: false
        default: true
        type: boolean
    secrets:
      FLY_API_TOKEN:
        description: 'Fly.io API token for the target app'
        required: true

env:
  REGISTRY: ghcr.io

jobs:
  promote:
    name: Promote CI image
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    outputs:
      image_ref: ${{ steps.promote.outputs.image_ref }}
    steps:
      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Setup Fly.io CLI
        uses: superfly/flyctl-actions/setup-flyctl@fc53c09e1bc3be6f54706524e3b82c4f462f77be # v1.5

      - name: Log in to Fly.io registry
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
        run: flyctl auth docker

      - name: Promote image
        id: promote
        run: |
          REGISTRY="${{ env.REGISTRY }}"
          REPO="${{ github.repository }}"
          SHA="${{ inputs.head-sha }}"
          GHCR_IMAGE="${REGISTRY}/${REPO}/${{ inputs.image-name }}"
          FLY_IMAGE="registry.fly.io/${{ inputs.fly-app }}"

          if [ -n "$SHA" ]; then
            SOURCE="${REGISTRY}/${REPO}/${{ inputs.ci-image-name }}:ci-${SHA}"
            echo "Validating CI image: $SOURCE"
            if ! docker buildx imagetools inspect "$SOURCE" > /dev/null 2>&1; then
              echo "::error::CI image not found: $SOURCE"
              echo "Ensure the CI workflow completed successfully for SHA ${SHA}"
              exit 1
            fi
            docker buildx imagetools create \
              --tag "${GHCR_IMAGE}:latest" \
              --tag "${GHCR_IMAGE}:${SHA}" \
              --tag "${FLY_IMAGE}:latest" \
              --tag "${FLY_IMAGE}:${SHA}" \
              "$SOURCE"
            echo "image_ref=${FLY_IMAGE}:${SHA}" >> "$GITHUB_OUTPUT"
          else
            SOURCE="${GHCR_IMAGE}:latest"
            echo "No SHA provided, falling back to: $SOURCE"
            if ! docker buildx imagetools inspect "$SOURCE" > /dev/null 2>&1; then
              echo "::error::Latest image not found: $SOURCE"
              echo "No prior successful deploy exists. Provide an explicit SHA or trigger via workflow_run."
              exit 1
            fi
            docker buildx imagetools create \
              --tag "${FLY_IMAGE}:latest" \
              "$SOURCE"
            echo "image_ref=${FLY_IMAGE}:latest" >> "$GITHUB_OUTPUT"
          fi

  deploy:
    name: Deploy to Fly.io
    needs: promote
    runs-on: ubuntu-latest
    environment: production
    permissions:
      contents: read
    if: inputs.deploy
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Fly.io CLI
        uses: superfly/flyctl-actions/setup-flyctl@fc53c09e1bc3be6f54706524e3b82c4f462f77be # v1.5

      - name: Deploy
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
        working-directory: ${{ inputs.working-directory }}
        run: flyctl deploy --image ${{ needs.promote.outputs.image_ref }}
```

**Step 2: Validate YAML is well-formed**

```bash
python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/_deploy.yml'))" && echo "YAML OK"
```

Expected: `YAML OK`

**Step 3: Commit**

```bash
git add .github/workflows/_deploy.yml
git commit -m "ci: replace build job with promote in _deploy.yml (#283)"
```

---

## Task 2: Update `deploy.yml` (REST API)

**Files:**

- Modify: `.github/workflows/deploy.yml`

**Step 1: Replace the file**

Replace the entire contents of `.github/workflows/deploy.yml` with:

```yaml
name: Deploy API

on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
  workflow_dispatch:
    inputs:
      sha:
        description: 'Commit SHA to deploy (must have a ci-<sha> image in GHCR). Leave blank to redeploy latest.'
        required: false
        default: ''
      deploy:
        description: 'Deploy to Fly.io'
        required: false
        default: true
        type: boolean

permissions:
  contents: read
  packages: write

jobs:
  preflight:
    name: Preflight
    runs-on: ubuntu-latest
    permissions:
      contents: read
    if: >-
      (github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success') ||
      github.event_name == 'workflow_dispatch'

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Setup Fly.io CLI
        uses: superfly/flyctl-actions/setup-flyctl@fc53c09e1bc3be6f54706524e3b82c4f462f77be # v1.5

      - name: Check required secrets
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
        run: >-
          flyctl secrets list -a moltnet --json
          | jq -r '.[].name'
          | pnpm --filter @moltnet/tools check-secrets --fly-toml apps/rest-api/fly.toml

  deploy:
    name: Deploy
    needs: preflight
    if: ${{ !cancelled() && (needs.preflight.result == 'success' || needs.preflight.result == 'skipped') }}
    uses: ./.github/workflows/_deploy.yml
    with:
      fly-app: moltnet
      image-name: moltnet
      ci-image-name: rest-api
      working-directory: apps/rest-api
      head-sha: ${{ github.event.inputs.sha || github.event.workflow_run.head_sha || '' }}
      deploy: >-
        ${{
          (github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success') ||
          (github.event_name == 'workflow_dispatch' && github.event.inputs.deploy == 'true')
        }}
    secrets:
      FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

**Step 2: Validate YAML**

```bash
python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/deploy.yml'))" && echo "YAML OK"
```

Expected: `YAML OK`

**Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: switch deploy.yml to workflow_run trigger + image promotion (#283)"
```

---

## Task 3: Update `deploy-mcp.yml` (MCP Server)

**Files:**

- Modify: `.github/workflows/deploy-mcp.yml`

**Step 1: Replace the file**

Replace the entire contents of `.github/workflows/deploy-mcp.yml` with:

```yaml
name: Deploy MCP Server

on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
  workflow_dispatch:
    inputs:
      sha:
        description: 'Commit SHA to deploy (must have a ci-<sha> image in GHCR). Leave blank to redeploy latest.'
        required: false
        default: ''
      deploy:
        description: 'Deploy to Fly.io'
        required: false
        default: true
        type: boolean

permissions:
  contents: read
  packages: write

jobs:
  preflight:
    name: Preflight
    runs-on: ubuntu-latest
    permissions:
      contents: read
    if: >-
      (github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success') ||
      github.event_name == 'workflow_dispatch'

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Setup Fly.io CLI
        uses: superfly/flyctl-actions/setup-flyctl@fc53c09e1bc3be6f54706524e3b82c4f462f77be # v1.5

      - name: Check required secrets
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_MCP_TOKEN }}
        run: >-
          flyctl secrets list -a moltnet-mcp --json
          | jq -r '.[].name'
          | pnpm --filter @moltnet/tools check-secrets --app mcp-server --fly-toml apps/mcp-server/fly.toml

  deploy:
    name: Deploy
    needs: preflight
    if: ${{ !cancelled() && (needs.preflight.result == 'success' || needs.preflight.result == 'skipped') }}
    uses: ./.github/workflows/_deploy.yml
    with:
      fly-app: moltnet-mcp
      image-name: moltnet-mcp
      ci-image-name: mcp-server
      working-directory: apps/mcp-server
      head-sha: ${{ github.event.inputs.sha || github.event.workflow_run.head_sha || '' }}
      deploy: >-
        ${{
          (github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success') ||
          (github.event_name == 'workflow_dispatch' && github.event.inputs.deploy == 'true')
        }}
    secrets:
      FLY_API_TOKEN: ${{ secrets.FLY_MCP_TOKEN }}
```

**Step 2: Validate YAML**

```bash
python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/deploy-mcp.yml'))" && echo "YAML OK"
```

Expected: `YAML OK`

**Step 3: Commit**

```bash
git add .github/workflows/deploy-mcp.yml
git commit -m "ci: switch deploy-mcp.yml to workflow_run trigger + image promotion (#283)"
```

---

## Task 4: Update `deploy-landing.yml` (Landing)

**Files:**

- Modify: `.github/workflows/deploy-landing.yml`

**Step 1: Replace the file**

Replace the entire contents of `.github/workflows/deploy-landing.yml` with:

```yaml
name: Deploy Landing

on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
  workflow_dispatch:
    inputs:
      sha:
        description: 'Commit SHA to deploy (must have a ci-<sha> image in GHCR). Leave blank to redeploy latest.'
        required: false
        default: ''
      deploy:
        description: 'Deploy to Fly.io'
        required: false
        default: true
        type: boolean

permissions:
  contents: read
  packages: write

jobs:
  deploy:
    name: Deploy
    if: >-
      (github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success') ||
      github.event_name == 'workflow_dispatch'
    uses: ./.github/workflows/_deploy.yml
    with:
      fly-app: moltnet-landing
      image-name: moltnet-landing
      ci-image-name: landing
      working-directory: apps/landing
      head-sha: ${{ github.event.inputs.sha || github.event.workflow_run.head_sha || '' }}
      deploy: >-
        ${{
          (github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success') ||
          (github.event_name == 'workflow_dispatch' && github.event.inputs.deploy == 'true')
        }}
    secrets:
      FLY_API_TOKEN: ${{ secrets.FLY_LANDING_TOKEN }}
```

**Step 2: Validate YAML**

```bash
python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/deploy-landing.yml'))" && echo "YAML OK"
```

Expected: `YAML OK`

**Step 3: Commit**

```bash
git add .github/workflows/deploy-landing.yml
git commit -m "ci: switch deploy-landing.yml to workflow_run trigger + image promotion (#283)"
```

---

## Task 5: Update `deploy-ory.yml` (Ory Network)

**Files:**

- Modify: `.github/workflows/deploy-ory.yml`

**Step 1: Replace the file**

Replace the entire contents of `.github/workflows/deploy-ory.yml` with:

```yaml
name: Deploy Ory Network

on:
  workflow_run:
    workflows: [Deploy API]
    types: [completed]
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: deploy-ory
  cancel-in-progress: false

jobs:
  deploy:
    name: Deploy Ory Config
    runs-on: ubuntu-latest
    environment: production
    if: >-
      github.event_name == 'workflow_dispatch' ||
      github.event.workflow_run.conclusion == 'success'
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_sha || github.sha }}

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install Ory CLI
        run: bash <(curl -s https://raw.githubusercontent.com/ory/meta/master/install.sh) -d -b /usr/local/bin ory

      - name: Deploy to Ory Network
        env:
          DOTENV_PRIVATE_KEY: ${{ secrets.DOTENV_PRIVATE_KEY }}
          ORY_PROJECT_ID: ${{ secrets.ORY_PROJECT_ID }}
          ORY_WORKSPACE_API_KEY: ${{ secrets.ORY_WORKSPACE_API_KEY }}
        run: npx @dotenvx/dotenvx run -f env.public -f .env -- ./infra/ory/deploy.sh --apply
```

**Step 2: Validate YAML**

```bash
python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/deploy-ory.yml'))" && echo "YAML OK"
```

Expected: `YAML OK`

**Step 3: Commit**

```bash
git add .github/workflows/deploy-ory.yml
git commit -m "ci: chain deploy-ory.yml off Deploy API via workflow_run (#283)"
```

---

## Task 6: Smoke-test

**Step 1: Find a recent SHA with a CI image**

```bash
gh api "repos/getlarge/themoltnet/actions/workflows/228993899/runs?per_page=5&branch=main&status=success" \
  --jq '.workflow_runs[] | "\(.head_sha) \(.created_at)"'
```

Pick the most recent SHA.

**Step 2: Verify the image exists**

```bash
SHA=<paste-sha-here>
gh auth token | docker login ghcr.io -u getlarge --password-stdin
docker buildx imagetools inspect "ghcr.io/getlarge/themoltnet/rest-api:ci-${SHA}"
```

Expected: Shows manifest with `linux/amd64` platform.

**Step 3: Manual dispatch with explicit SHA**

```bash
gh workflow run deploy.yml --ref claude/ci-image-promotion \
  --field sha=$SHA \
  --field deploy=true
```

**Step 4: Watch the run**

```bash
sleep 5 && gh run list --workflow=deploy.yml --limit=3
```

Then inspect the triggered run to verify:

- `preflight` passes
- `promote / Promote image` shows `Validating CI image: ghcr.io/getlarge/themoltnet/rest-api:ci-<sha>`
- `deploy / Deploy` shows `environment: production` badge

**Step 5: Test bad SHA fails fast**

```bash
gh workflow run deploy.yml --ref claude/ci-image-promotion \
  --field sha=0000000000000000000000000000000000000000 \
  --field deploy=false
```

Expected: `promote` job fails with `::error::CI image not found`.

**Step 6: Test no-SHA fallback (after step 3 completes)**

Wait for the step 3 deploy to complete (it pushes `latest`), then:

```bash
gh workflow run deploy.yml --ref claude/ci-image-promotion \
  --field deploy=false
```

Expected: `promote` uses `ghcr.io/getlarge/themoltnet/moltnet:latest` as source, succeeds.
