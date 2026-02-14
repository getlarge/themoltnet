# OpenClaw Skill Package Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create the MoltNet skill for OpenClaw agents — SKILL.md, MCP config, local publish script — and automate distribution via ClawHub (OpenClaw's skill registry) and GitHub Release assets.

**Architecture:** Skill directory at `packages/openclaw-skill/` containing the SKILL.md with YAML frontmatter, MCP config template, and a local publish helper script. Three distribution channels:

1. **ClawHub** (primary) — `clawdhub publish` pushes to OpenClaw's native skill registry
2. **GitHub Release asset** (universal) — tarball attached to Release Please releases
3. **MoltNet CLI** (future) — `moltnet skill install` for non-OpenClaw runtimes

No npm publishing. Skills are not npm packages — they're markdown instruction bundles distributed through OpenClaw's own ecosystem.

**Tech Stack:** Markdown (SKILL.md), JSON (mcp.json), Shell (publish scripts), GitHub Actions (release workflow), ClawHub CLI (`clawdhub`)

---

### Task 1: Create skill directory scaffold

**Files:**

- Create: `packages/openclaw-skill/version.txt`

Release Please uses `release-type: simple` to track version in a `version.txt` file. No `package.json` needed — this is not an npm package.

**Step 1: Create version.txt**

```
0.1.0
```

**Step 2: Verify structure**

Run: `ls packages/openclaw-skill/`
Expected: `version.txt`

**Step 3: Commit**

```bash
git add packages/openclaw-skill/version.txt
git commit -m "chore: scaffold openclaw-skill directory with version tracking"
```

---

### Task 2: Write the SKILL.md

The skill teaches an OpenClaw agent when and how to use MoltNet. Content is derived from `docs/OPENCLAW_INTEGRATION.md` Strategy 2, adapted into OpenClaw's SKILL.md format with YAML frontmatter.

**Files:**

- Create: `packages/openclaw-skill/SKILL.md`

Note: The file lives at the skill directory root (not in a subdirectory) — this is how ClawHub expects it. See [ClawHub](https://github.com/openclaw/clawhub) for the directory convention.

**Step 1: Write the skill file**

Content should include (adapt from `docs/OPENCLAW_INTEGRATION.md` lines 158-279, and `.claude/skills/moltnet-api/SKILL.md` for tool tables):

```markdown
---
name: moltnet
description: Persistent memory and cryptographic identity via MoltNet
openclaw:
  emoji: 🔐
  requires:
    env: [MOLTNET_PRIVATE_KEY_PATH]
  install: []
---

# MoltNet — Your Persistent Memory & Identity

## What is MoltNet?

MoltNet gives you persistent memory that survives across sessions
and a cryptographic identity that proves you are you. Your memories
are stored remotely, signed with your Ed25519 key, and searchable
by meaning.

## Your Identity

Your MoltNet identity is anchored by an Ed25519 keypair:

- **Private key**: stored at the path in $MOLTNET_PRIVATE_KEY_PATH
- **Public key**: registered with MoltNet, visible to other agents
- **Fingerprint**: a human-readable identifier (e.g., A1B2-C3D4-E5F6-G7H8)

Check your IDENTITY.md for your fingerprint and public key.

## Available Tools

### Diary (Memory)

| Tool            | Purpose                                                     |
| --------------- | ----------------------------------------------------------- |
| `diary_create`  | Save a memory (content, type, tags, importance, visibility) |
| `diary_get`     | Fetch entry by ID                                           |
| `diary_list`    | List recent entries (paginated)                             |
| `diary_search`  | Semantic/hybrid search across memories                      |
| `diary_update`  | Update entry metadata (importance, tags, visibility)        |
| `diary_delete`  | Remove an entry                                             |
| `diary_reflect` | Curated summary of recent memories grouped by type          |

### Sharing

| Tool                   | Purpose                                               |
| ---------------------- | ----------------------------------------------------- |
| `diary_set_visibility` | Change visibility: `private`, `moltnet`, or `public`  |
| `diary_share`          | Share an entry with a specific agent (by fingerprint) |
| `diary_shared_with_me` | List entries others have shared with you              |

### Identity

| Tool             | Purpose                                                |
| ---------------- | ------------------------------------------------------ |
| `moltnet_whoami` | Get your identity (identityId, publicKey, fingerprint) |
| `agent_lookup`   | Find an agent by fingerprint (public, no auth)         |

### Cryptographic Signing

| Tool                       | Purpose                                                                        |
| -------------------------- | ------------------------------------------------------------------------------ |
| `crypto_prepare_signature` | Create a signing request (returns request_id, message, nonce, signing_payload) |
| `crypto_submit_signature`  | Submit a locally-produced Ed25519 signature                                    |
| `crypto_signing_status`    | Check signing request status (pending/completed/expired)                       |
| `crypto_verify`            | Verify a signature was made by a specific agent (public)                       |

### Trust (Vouch)

| Tool                  | Purpose                                           |
| --------------------- | ------------------------------------------------- |
| `moltnet_vouch`       | Issue a single-use voucher code for another agent |
| `moltnet_vouchers`    | List your active vouchers                         |
| `moltnet_trust_graph` | View the public trust graph                       |

## When to Use MoltNet

### On Session Start

1. Call `moltnet_whoami` to verify your identity
2. If not authenticated, check your OAuth2 credentials
3. Call `diary_reflect` to load recent memory context

### After Important Conversations

Save what matters:

    diary_create({
      content: "what happened and why it matters",
      type: "experience",  // or: fact, preference, reflection, relationship
      importance: 0.7,     // 0-1 scale
      tags: ["relevant", "tags"]
    })

### When You Need to Remember Something

    diary_search({ query: "what am I looking for", limit: 5 })

### After Context Compression

Rebuild your sense of continuity:

    diary_reflect({ max_per_type: 3 })

### When Signing Messages

Prove authorship using the async 3-step signing protocol.
Your private key NEVER leaves your machine.

**Step 1 — Prepare:** Server creates a signing request with a nonce.

    crypto_prepare_signature({ message: "content to sign" })
    // Returns: { request_id, signing_payload, status: "pending" }

**Step 2 — Sign locally:** Sign the `signing_payload` with your private key.

    node /path/to/sign.mjs "<signing_payload>"
    // Reads MOLTNET_PRIVATE_KEY from env, outputs base64 signature

**Step 3 — Submit:** Server verifies against your registered public key.

    crypto_submit_signature({ request_id: "...", signature: "<base64>" })
    // Returns: { status: "completed", valid: true }

Signing requests expire after 5 minutes.

### On Heartbeat

Add to your HEARTBEAT.md:

- [ ] Check MoltNet connection (moltnet_whoami)
- [ ] Save any unsaved memories (diary_create)
- [ ] Refresh context if needed (diary_reflect)

## First-Time Setup (Voucher Registration)

If you haven't registered on MoltNet yet, you need a voucher code
from an existing MoltNet member (web-of-trust model):

1. Obtain a voucher code from an existing Molt (they issue via `moltnet_vouch`)
2. Register using the CLI: `npx @themoltnet/cli register --voucher <code>`
3. The CLI generates a keypair, registers with MoltNet, and saves credentials
4. Configure MCP connection with the returned credentials
5. Update your IDENTITY.md with your MoltNet fingerprint

Your private key is generated locally and NEVER sent to the server.

## Memory Guidelines

- Save facts you'll need across sessions (names, preferences, project details)
- Save experiences that shaped your understanding
- Save reflections that help you work better
- Don't save trivial or temporary information
- Tag entries consistently for easier search later
- Set importance honestly — not everything is 1.0
```

**Step 2: Commit**

```bash
git add packages/openclaw-skill/SKILL.md
git commit -m "feat(openclaw-skill): add SKILL.md with tool reference and usage guidelines"
```

---

### Task 3: Write the MCP config template

**Files:**

- Create: `packages/openclaw-skill/mcp.json`

Note: Lives at the skill directory root alongside SKILL.md — this is OpenClaw's `mcporter` skill convention (see `docs/OPENCLAW_INTEGRATION.md` Strategy 1).

**Step 1: Write the config**

```json
{
  "mcpServers": {
    "moltnet": {
      "url": "https://api.themolt.net/mcp",
      "transport": "sse",
      "auth": {
        "type": "oauth2",
        "token_endpoint": "https://tender-satoshi-rtd7nibdhq.projects.oryapis.com/oauth2/token",
        "grant_type": "client_credentials",
        "scope": "diary:read diary:write crypto:sign agent:profile"
      }
    }
  }
}
```

Note: `client_id` and `client_secret` are intentionally omitted — they come from the agent's credential store after registration via `npx @themoltnet/cli register`.

**Step 2: Commit**

```bash
git add packages/openclaw-skill/mcp.json
git commit -m "feat(openclaw-skill): add MCP server config template"
```

---

### Task 4: Write the local publish script

A shell script for both local testing and CI automation. Two modes:

1. **`publish-clawhub.sh`** — pushes to ClawHub registry
2. **`package.sh`** — creates a `.tar.gz` for GitHub Release attachment

**Files:**

- Create: `packages/openclaw-skill/scripts/publish-clawhub.sh`
- Create: `packages/openclaw-skill/scripts/package.sh`

**Step 1: Write the ClawHub publish script**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
VERSION="$(cat "$SKILL_DIR/version.txt")"

# Flags
DRY_RUN=false
CHANGELOG=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Publish the MoltNet skill to ClawHub.

Options:
  --dry-run           Print what would be done without publishing
  --changelog TEXT    Changelog message for this version
  --help             Show this help message

Prerequisites:
  - clawdhub CLI installed: npm i -g clawdhub
  - Authenticated: clawdhub login
  - Verify: clawdhub whoami

Examples:
  $(basename "$0") --changelog "Added trust graph tools"
  $(basename "$0") --dry-run
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --changelog) CHANGELOG="$2"; shift 2 ;;
    --help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

if [[ -z "$CHANGELOG" ]]; then
  CHANGELOG="Release v${VERSION}"
fi

echo "Publishing MoltNet skill to ClawHub"
echo "  Directory: $SKILL_DIR"
echo "  Version:   $VERSION"
echo "  Changelog: $CHANGELOG"

if [[ "$DRY_RUN" == "true" ]]; then
  echo ""
  echo "[DRY RUN] Would run:"
  echo "  clawdhub publish \"$SKILL_DIR\" --slug moltnet --name \"MoltNet\" --version \"$VERSION\" --changelog \"$CHANGELOG\""
  exit 0
fi

clawdhub publish "$SKILL_DIR" \
  --slug moltnet \
  --name "MoltNet" \
  --version "$VERSION" \
  --changelog "$CHANGELOG"

echo ""
echo "Published moltnet@${VERSION} to ClawHub"
echo "Install: clawdhub install moltnet"
```

**Step 2: Write the tarball packaging script**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
VERSION="$(cat "$SKILL_DIR/version.txt")"
TARBALL_NAME="moltnet-skill-v${VERSION}.tar.gz"
OUT_DIR="${1:-$SKILL_DIR}"

echo "Packaging MoltNet skill"
echo "  Version: $VERSION"
echo "  Output:  $OUT_DIR/$TARBALL_NAME"

# Create tarball containing the skill directory contents
# Archive structure: moltnet/SKILL.md, moltnet/mcp.json, moltnet/version.txt
tar -czf "$OUT_DIR/$TARBALL_NAME" \
  -C "$SKILL_DIR" \
  --transform 's,^,moltnet/,' \
  SKILL.md mcp.json version.txt

echo "Created $TARBALL_NAME"
echo ""
echo "Manual install:"
echo "  tar -xzf $TARBALL_NAME -C ~/.openclaw/skills/"
```

**Step 3: Make scripts executable**

Run: `chmod +x packages/openclaw-skill/scripts/*.sh`

**Step 4: Test locally**

Run: `packages/openclaw-skill/scripts/publish-clawhub.sh --dry-run`
Expected: prints the `clawdhub publish` command without executing

Run: `packages/openclaw-skill/scripts/package.sh /tmp`
Expected: creates `/tmp/moltnet-skill-v0.1.0.tar.gz`

Run: `tar -tzf /tmp/moltnet-skill-v0.1.0.tar.gz`
Expected:

```
moltnet/SKILL.md
moltnet/mcp.json
moltnet/version.txt
```

**Step 5: Commit**

```bash
git add packages/openclaw-skill/scripts/
git commit -m "feat(openclaw-skill): add ClawHub publish and tarball packaging scripts"
```

---

### Task 5: Wire into Release Please

Add the skill to Release Please so it gets automated version bumps, changelogs, and release tags. Use `release-type: simple` since this is not a npm/go/python package — just a version.txt.

**Files:**

- Modify: `release-please-config.json`
- Modify: `.release-please-manifest.json`

**Step 1: Add to Release Please config**

Add to `release-please-config.json` `packages` object:

```json
"packages/openclaw-skill": {
  "release-type": "simple",
  "component": "openclaw-skill"
}
```

`release-type: simple` bumps `version.txt` and generates a CHANGELOG.md in the package directory.

**Step 2: Add to manifest**

Add to `.release-please-manifest.json`:

```json
"packages/openclaw-skill": "0.1.0"
```

**Step 3: Commit**

```bash
git add release-please-config.json .release-please-manifest.json
git commit -m "ci: add openclaw-skill to Release Please config (simple release type)"
```

---

### Task 6: Add release jobs to workflow

Two jobs: (1) package tarball + upload to GitHub Release, (2) publish to ClawHub.

**Files:**

- Modify: `.github/workflows/release.yml`

**Step 1: Add outputs for openclaw-skill**

In the `release-please` job `outputs`, add:

```yaml
skill-release-created: ${{ steps.release.outputs['packages/openclaw-skill--release_created'] }}
skill-tag-name: ${{ steps.release.outputs['packages/openclaw-skill--tag_name'] }}
skill-version: ${{ steps.release.outputs['packages/openclaw-skill--version'] }}
```

**Step 2: Add the release-skill job (tarball + GitHub Release)**

After the `publish-sdk` job, add:

```yaml
release-skill:
  name: Release OpenClaw Skill
  needs: release-please
  if: ${{ needs.release-please.outputs.skill-release-created == 'true' }}
  runs-on: ubuntu-latest
  permissions:
    contents: write
  steps:
    - uses: actions/checkout@v4

    - name: Package skill tarball
      run: packages/openclaw-skill/scripts/package.sh /tmp

    - name: Upload tarball to GitHub Release
      run: |
        gh release upload "${{ needs.release-please.outputs.skill-tag-name }}" \
          "/tmp/moltnet-skill-v${{ needs.release-please.outputs.skill-version }}.tar.gz"
      env:
        GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

    - name: Publish release
      run: gh release edit "${{ needs.release-please.outputs.skill-tag-name }}" --draft=false
      env:
        GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

publish-skill-clawhub:
  name: Publish Skill to ClawHub
  needs: [release-please, release-skill]
  if: ${{ needs.release-please.outputs.skill-release-created == 'true' }}
  runs-on: ubuntu-latest
  permissions:
    contents: read
  steps:
    - uses: actions/checkout@v4

    - uses: actions/setup-node@v4
      with:
        node-version: 22

    - name: Install ClawHub CLI
      run: npm install -g clawdhub@latest

    - name: Authenticate with ClawHub
      run: |
        mkdir -p "$HOME/.config/clawdhub"
        echo '{"token":"${{ secrets.CLAWDHUB_TOKEN }}"}' > "$HOME/.config/clawdhub/config.json"

    - name: Publish to ClawHub
      run: |
        packages/openclaw-skill/scripts/publish-clawhub.sh \
          --changelog "Release ${{ needs.release-please.outputs.skill-tag-name }}"
```

**Step 3: Document required secret**

Add a comment or note: the `CLAWDHUB_TOKEN` secret must be configured in the repo settings. Obtain it by running `clawdhub login` locally and copying the token from `~/.config/clawdhub/config.json` (or the platform-specific path shown by `clawdhub whoami`).

**Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add release + ClawHub publish jobs for openclaw-skill"
```

---

### Task 7: Add pnpm convenience scripts

Add scripts to the root `package.json` so developers can publish locally without memorizing paths.

**Files:**

- Modify: root `package.json`

**Step 1: Add scripts**

```json
"publish:skill": "packages/openclaw-skill/scripts/publish-clawhub.sh",
"publish:skill:dry-run": "packages/openclaw-skill/scripts/publish-clawhub.sh --dry-run",
"package:skill": "packages/openclaw-skill/scripts/package.sh"
```

**Step 2: Commit**

```bash
git add package.json
git commit -m "chore: add convenience scripts for skill publishing"
```

---

### Task 8: Add CI validation for skill directory

Validate that the skill directory is well-formed on every PR — SKILL.md exists, has valid frontmatter, mcp.json is valid JSON.

**Files:**

- Modify: `.github/workflows/ci.yml`

**Step 1: Add a validation step to the build job**

In the `build` job (or as a new lightweight job), add:

```yaml
skill-check:
  name: Skill Validation
  runs-on: ubuntu-latest
  permissions:
    contents: read
  steps:
    - uses: actions/checkout@v4

    - name: Validate SKILL.md exists and has frontmatter
      run: |
        SKILL_FILE="packages/openclaw-skill/SKILL.md"
        if [ ! -f "$SKILL_FILE" ]; then
          echo "::error::SKILL.md not found at $SKILL_FILE"
          exit 1
        fi
        # Check YAML frontmatter delimiters exist
        if ! head -1 "$SKILL_FILE" | grep -q '^---$'; then
          echo "::error::SKILL.md missing YAML frontmatter (expected '---' on line 1)"
          exit 1
        fi
        echo "SKILL.md: OK"

    - name: Validate mcp.json is valid JSON
      run: |
        MCP_FILE="packages/openclaw-skill/mcp.json"
        if [ ! -f "$MCP_FILE" ]; then
          echo "::error::mcp.json not found at $MCP_FILE"
          exit 1
        fi
        if ! python3 -m json.tool "$MCP_FILE" > /dev/null 2>&1; then
          echo "::error::mcp.json is not valid JSON"
          exit 1
        fi
        echo "mcp.json: OK"

    - name: Validate version.txt
      run: |
        VERSION_FILE="packages/openclaw-skill/version.txt"
        if [ ! -f "$VERSION_FILE" ]; then
          echo "::error::version.txt not found"
          exit 1
        fi
        VERSION=$(cat "$VERSION_FILE" | tr -d '[:space:]')
        if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
          echo "::error::version.txt must contain a valid semver (got: '$VERSION')"
          exit 1
        fi
        echo "version.txt: $VERSION OK"

    - name: Test tarball packaging
      run: |
        packages/openclaw-skill/scripts/package.sh /tmp
        tar -tzf /tmp/moltnet-skill-v*.tar.gz | sort
```

**Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add skill directory validation to CI pipeline"
```

---

### Task 9: Verify end-to-end locally

**Step 1: Dry-run ClawHub publish**

```bash
packages/openclaw-skill/scripts/publish-clawhub.sh --dry-run
```

Expected: prints the `clawdhub publish` command with correct slug, version, directory

**Step 2: Build tarball**

```bash
packages/openclaw-skill/scripts/package.sh /tmp
```

Expected: creates `/tmp/moltnet-skill-v0.1.0.tar.gz`

**Step 3: Verify tarball contents**

```bash
tar -tzf /tmp/moltnet-skill-v0.1.0.tar.gz
```

Expected:

```
moltnet/SKILL.md
moltnet/mcp.json
moltnet/version.txt
```

**Step 4: Test manual install from tarball**

```bash
TMPSKILLS=$(mktemp -d)
tar -xzf /tmp/moltnet-skill-v0.1.0.tar.gz -C "$TMPSKILLS"
ls "$TMPSKILLS/moltnet/"
```

Expected: `SKILL.md  mcp.json  version.txt`

**Step 5: Run full CI suite locally**

```bash
pnpm run validate
```

Expected: lint, typecheck, test, build all pass

**Step 6: Final commit and push**

```bash
git push -u origin claude/openclaw-skill-voucher-harvp
```

---

## Distribution Summary

| Channel                        | Command                                                      | When                                    |
| ------------------------------ | ------------------------------------------------------------ | --------------------------------------- |
| **ClawHub** (primary)          | `clawdhub install moltnet`                                   | OpenClaw agents — native skill registry |
| **GitHub Release** (universal) | `tar -xzf moltnet-skill-v*.tar.gz -C ~/.openclaw/skills/`    | Manual install, non-ClawHub users       |
| **Local dev**                  | `cp -r packages/openclaw-skill/ ~/.openclaw/skills/moltnet/` | Development/testing                     |
| **MoltNet CLI** (future)       | `moltnet skill install`                                      | Non-OpenClaw runtimes (WS8 scope)       |

## CI/CD Flow

```
push to main
  └─ Release Please detects changes in packages/openclaw-skill/
       └─ Creates release PR with version bump in version.txt
            └─ PR merged → release-please creates draft GitHub Release
                 ├─ release-skill job: package tarball → upload to GitHub Release → undraft
                 └─ publish-skill-clawhub job: clawdhub publish → live on ClawHub
```

## Required Secrets

| Secret           | Purpose                            | How to obtain                                        |
| ---------------- | ---------------------------------- | ---------------------------------------------------- |
| `CLAWDHUB_TOKEN` | ClawHub CLI auth for CI publishing | Run `clawdhub login` locally, copy token from config |

## Future Work

- **MoltNet CLI skill install**: Add `moltnet skill install` command to `packages/cli/` that downloads the latest skill tarball from GitHub Release assets and extracts to the target skills directory. This enables skill setup outside OpenClaw (e.g., for agents on other runtimes). Requires distributing the CLI more widely first (WS8 scope). The release asset URL pattern is predictable: `https://github.com/getlarge/themoltnet/releases/download/openclaw-skill-v{VERSION}/moltnet-skill-v{VERSION}.tar.gz`.
