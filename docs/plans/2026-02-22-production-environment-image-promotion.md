# Production Environment & Image Promotion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a single `production` GitHub Environment and replace the current rebuild-on-deploy pattern with image promotion — deploy the exact image that CI built and validated.

**Architecture:** CI builds images tagged `ci-<sha>` and runs E2E against them. On success, a `workflow_run`-triggered deploy job validates the image exists, retagges it for production registries (GHCR + Fly.io), and deploys. `workflow_dispatch` accepts an optional explicit SHA for rollbacks. Secrets move from repo-level to the `production` environment.

**Tech Stack:** GitHub Actions, Docker Buildx `imagetools`, Fly.io (`flyctl`), GHCR (`ghcr.io/getlarge/themoltnet/`)

---

## Background & Key Constraints

### Image name mapping

CI builds images with these names; deploy workflows currently use different names:

| CI image (`ci-<sha>` tag)                | Deploy `image-name` input | Fly app           |
| ---------------------------------------- | ------------------------- | ----------------- |
| `ghcr.io/getlarge/themoltnet/rest-api`   | `moltnet`                 | `moltnet`         |
| `ghcr.io/getlarge/themoltnet/mcp-server` | `moltnet-mcp`             | `moltnet-mcp`     |
| `ghcr.io/getlarge/themoltnet/landing`    | `moltnet-landing`         | `moltnet-landing` |

`_deploy.yml` needs a new `ci-image-name` input so it knows where to pull the source CI image from.

### SHA resolution — three trigger cases

| Trigger                               | SHA source                                                         |
| ------------------------------------- | ------------------------------------------------------------------ |
| `workflow_run` (normal CI → deploy)   | `github.event.workflow_run.head_sha`                               |
| `workflow_dispatch` with explicit SHA | `github.event.inputs.sha` (rollback)                               |
| `workflow_dispatch` without SHA       | `github.sha` (HEAD — user's responsibility to ensure image exists) |

Expression: `${{ github.event.inputs.sha || github.event.workflow_run.head_sha || github.sha }}`

### `workflow_run` does not support `paths:` filters

Current deploy workflows filter by changed paths. `workflow_run` doesn't support this. Since the promote+deploy step is now cheap (no build), deploy always runs after CI succeeds on `main`. This is acceptable.

### `deploy-ory.yml` is out of scope

It deploys Ory config, not a Docker image. Leave it on `push` to `main`.

---

## Task 1: Create the GitHub Environment (manual — do this first)

This cannot be automated via workflow files; it must be done in the GitHub UI.

**Steps:**

1. Go to the repository → **Settings** → **Environments** → **New environment**
2. Name it `production`
3. No protection rules needed for now (no required reviewers, no wait timer)
4. Under **Environment secrets**, add these three secrets (copy values from **Settings → Secrets → Actions → Repository secrets**):
   - `FLY_API_TOKEN`
   - `FLY_MCP_TOKEN`
   - `FLY_LANDING_TOKEN`
5. Under **Environment secrets**, also add the three Ory secrets:
   - `DOTENV_PRIVATE_KEY`
   - `ORY_PROJECT_ID`
   - `ORY_WORKSPACE_API_KEY`
6. After confirming all six environment secrets are saved, delete them from **Repository secrets** (they should only live at the environment level now)

**Verify:** Go to **Settings → Environments → production** and confirm all six secrets are listed there.

---

## Task 2: Update `_deploy.yml` — replace build with promote

**Files:**

- Modify: `.github/workflows/_deploy.yml`

This is the reusable workflow called by all three deploy workflows. Replace the `build` job (which rebuilds the image from source) with a `promote` job that validates the CI image and retagges it.

### Step 1: Read the current file

Read `.github/workflows/_deploy.yml` in full to have the exact content before editing.

### Step 2: Rewrite `_deploy.yml`

Replace the entire file with:

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
        description: 'Production container image name (under ghcr.io/<owner>/)'
        required: true
        type: string
      ci-image-name:
        description: 'CI container image name (under ghcr.io/<owner>/), as built by the CI workflow'
        required: true
        type: string
      dockerfile:
        description: 'Path to Dockerfile (relative to repo root) — kept for reference, unused in promote flow'
        required: false
        default: ''
        type: string
      working-directory:
        description: 'Directory containing fly.toml'
        required: true
        type: string
      head-sha:
        description: 'Commit SHA of the image to promote (must have a ci-<sha> image in GHCR)'
        required: true
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
  IMAGE_OWNER: getlarge/themoltnet

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

      - name: Validate CI image exists
        id: validate
        run: |
          CI_IMAGE="${{ env.REGISTRY }}/${{ env.IMAGE_OWNER }}/${{ inputs.ci-image-name }}:ci-${{ inputs.head-sha }}"
          echo "Checking: $CI_IMAGE"
          if ! docker buildx imagetools inspect "$CI_IMAGE" > /dev/null 2>&1; then
            echo "::error::CI image not found: $CI_IMAGE"
            echo "Ensure the CI workflow completed successfully for SHA ${{ inputs.head-sha }}"
            exit 1
          fi
          echo "CI image found: $CI_IMAGE"

      - name: Promote image
        id: promote
        run: |
          SOURCE="${{ env.REGISTRY }}/${{ env.IMAGE_OWNER }}/${{ inputs.ci-image-name }}:ci-${{ inputs.head-sha }}"
          GHCR_IMAGE="${{ env.REGISTRY }}/${{ env.IMAGE_OWNER }}/${{ inputs.image-name }}"
          FLY_IMAGE="registry.fly.io/${{ inputs.fly-app }}"
          SHA="${{ inputs.head-sha }}"

          docker buildx imagetools create \
            --tag "${GHCR_IMAGE}:latest" \
            --tag "${GHCR_IMAGE}:${SHA}" \
            --tag "${FLY_IMAGE}:${SHA}" \
            "$SOURCE"

          echo "image_ref=${FLY_IMAGE}:${SHA}" >> "$GITHUB_OUTPUT"
          echo "Promoted $SOURCE → ${GHCR_IMAGE}:latest, ${GHCR_IMAGE}:${SHA}, ${FLY_IMAGE}:${SHA}"

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

### Step 3: Verify the file is valid YAML

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/_deploy.yml'))" && echo "OK"
```

Expected: `OK`

### Step 4: Commit

```bash
git add .github/workflows/_deploy.yml
git commit -m "ci: replace image build with promotion in reusable deploy workflow"
```

---

## Task 3: Update `deploy.yml` (REST API)

**Files:**

- Modify: `.github/workflows/deploy.yml`

### Step 1: Read current file

Read `.github/workflows/deploy.yml` in full.

### Step 2: Rewrite trigger and job

Replace the entire file with:

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
        description: 'Commit SHA to deploy (must have a ci-<sha> image in GHCR). Leave blank for HEAD.'
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
      (github.event_name == 'workflow_dispatch' && github.event.inputs.deploy == 'true')

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
      head-sha: ${{ github.event.inputs.sha || github.event.workflow_run.head_sha || github.sha }}
      deploy: >-
        ${{
          (github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success') ||
          (github.event_name == 'workflow_dispatch' && github.event.inputs.deploy == 'true')
        }}
    secrets:
      FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

### Step 3: Validate YAML

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))" && echo "OK"
```

### Step 4: Commit

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: trigger API deploy from CI workflow_run, promote image by SHA"
```

---

## Task 4: Update `deploy-mcp.yml` (MCP Server)

**Files:**

- Modify: `.github/workflows/deploy-mcp.yml`

### Step 1: Read current file

Read `.github/workflows/deploy-mcp.yml` in full.

### Step 2: Rewrite

Replace the entire file with:

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
        description: 'Commit SHA to deploy (must have a ci-<sha> image in GHCR). Leave blank for HEAD.'
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
      (github.event_name == 'workflow_dispatch' && github.event.inputs.deploy == 'true')

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
      head-sha: ${{ github.event.inputs.sha || github.event.workflow_run.head_sha || github.sha }}
      deploy: >-
        ${{
          (github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success') ||
          (github.event_name == 'workflow_dispatch' && github.event.inputs.deploy == 'true')
        }}
    secrets:
      FLY_API_TOKEN: ${{ secrets.FLY_MCP_TOKEN }}
```

### Step 3: Validate YAML

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-mcp.yml'))" && echo "OK"
```

### Step 4: Commit

```bash
git add .github/workflows/deploy-mcp.yml
git commit -m "ci: trigger MCP deploy from CI workflow_run, promote image by SHA"
```

---

## Task 5: Update `deploy-landing.yml` (Landing)

**Files:**

- Modify: `.github/workflows/deploy-landing.yml`

### Step 1: Read current file

Read `.github/workflows/deploy-landing.yml` in full.

### Step 2: Rewrite

Replace the entire file with:

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
        description: 'Commit SHA to deploy (must have a ci-<sha> image in GHCR). Leave blank for HEAD.'
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
    uses: ./.github/workflows/_deploy.yml
    if: >-
      (github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success') ||
      (github.event_name == 'workflow_dispatch' && github.event.inputs.deploy == 'true')
    with:
      fly-app: moltnet-landing
      image-name: moltnet-landing
      ci-image-name: landing
      working-directory: apps/landing
      head-sha: ${{ github.event.inputs.sha || github.event.workflow_run.head_sha || github.sha }}
      deploy: >-
        ${{
          (github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success') ||
          (github.event_name == 'workflow_dispatch' && github.event.inputs.deploy == 'true')
        }}
    secrets:
      FLY_API_TOKEN: ${{ secrets.FLY_LANDING_TOKEN }}
```

### Step 3: Validate YAML

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-landing.yml'))" && echo "OK"
```

### Step 4: Commit

```bash
git add .github/workflows/deploy-landing.yml
git commit -m "ci: trigger landing deploy from CI workflow_run, promote image by SHA"
```

---

## Task 6: Update `deploy-ory.yml` (Ory Network)

**Files:**

- Modify: `.github/workflows/deploy-ory.yml`

No image promotion needed — this deploys Ory config via their CLI. However, Ory config changes often depend on a new API being live first (e.g., new OAuth2 callback routes, new Keto permission rules). To prevent Ory from deploying before the API is up, chain this workflow off the **Deploy API** workflow, not CI directly.

Deployment sequence: `CI → Deploy API → Deploy Ory`

This means Ory deploys only after the API is confirmed deployed. If no API changes are in the commit, Deploy API still completes (it always runs after CI), so the chain is preserved.

`workflow_dispatch` is kept for manual/emergency Ory-only redeploys.

### Step 1: Read current file

Read `.github/workflows/deploy-ory.yml` in full.

### Step 2: Rewrite with `workflow_run` on Deploy API

Replace the entire file with:

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
          # For workflow_run, checkout the commit that triggered the upstream workflow
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

Note the `ref:` on checkout — without it, `workflow_run` would checkout the default branch HEAD, not the commit that triggered the API deploy. This ensures the Ory config deployed matches the commit that was just released.

### Step 3: Validate YAML

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-ory.yml'))" && echo "OK"
```

### Step 4: Commit

```bash
git add .github/workflows/deploy-ory.yml
git commit -m "ci: chain Ory deploy after API deploy, add production environment"
```

---

## Task 7: Smoke-test with a manual dispatch

After merging to `main` (or from the feature branch for testing), verify end-to-end.

### Step 1: Find a recent SHA with a known CI image

```bash
# List recent ci-tagged images for rest-api in GHCR (requires gh CLI auth)
gh api /orgs/getlarge/packages/container/themoltnet%2Frest-api/versions \
  --jq '.[].metadata.container.tags[] | select(startswith("ci-"))' \
  | head -5
```

Pick any SHA from the output (strip the `ci-` prefix).

### Step 2: Trigger manual dispatch for API deploy

```bash
gh workflow run deploy.yml \
  --field sha=<SHA-from-step-1> \
  --field deploy=true
```

### Step 3: Watch the workflow run

```bash
gh run watch
```

Expected sequence:

1. `preflight` — Fly secrets check passes
2. `promote / Validate CI image exists` — exits 0
3. `promote / Promote image` — retagges to GHCR + Fly registry
4. `deploy / Deploy` — `flyctl deploy` succeeds, shows `environment: production` badge

### Step 4: Verify deployment tracking in GitHub UI

Go to the repository main page. Under **Environments**, `production` should now show the latest deployment with a link to the workflow run.

### Step 5: Verify a bad SHA fails fast

```bash
gh workflow run deploy.yml \
  --field sha=0000000000000000000000000000000000000000 \
  --field deploy=true
```

Expected: `promote / Validate CI image exists` step fails with `::error::CI image not found`.

---

## What is NOT in scope

- Adding protection rules or required reviewers to the `production` environment
- Staging environment or multi-environment promotion
- Sequencing MCP/Landing deploys relative to API (they all trigger from CI in parallel — only Ory is chained)
- OIDC / keyless auth (removes stored `FLY_*` tokens entirely) — future work
- Path-based filtering on deploy (intentionally dropped; deploy is now cheap)
