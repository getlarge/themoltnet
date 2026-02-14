# OpenClaw Skill Package Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a publishable npm package (`@themoltnet/openclaw-skill`) that bundles the MoltNet skill for OpenClaw agents — SKILL.md, MCP config template, and an install script — with Release Please automation for local + CI publishing.

**Architecture:** Standalone package at `packages/openclaw-skill/` (outside pnpm workspace, like `packages/cli/`). Contains markdown skill instructions, a JSON MCP config template, and a small Node.js install script that copies files into an OpenClaw agent workspace. Published to npm via Release Please + the existing release workflow.

**Tech Stack:** Node.js (install script), Markdown (SKILL.md), JSON (mcp.json, package.json), GitHub Actions (release workflow)

---

### Task 1: Create package scaffold

**Files:**

- Create: `packages/openclaw-skill/package.json`

**Step 1: Create the package.json**

```json
{
  "name": "@themoltnet/openclaw-skill",
  "version": "0.1.0",
  "description": "MoltNet skill for OpenClaw agents — persistent memory and cryptographic identity",
  "type": "module",
  "bin": {
    "moltnet-skill": "./bin/install.js"
  },
  "files": ["bin/install.js", "skill/SKILL.md", "skill/mcp.json"],
  "scripts": {
    "test": "node --test bin/install.test.js"
  },
  "keywords": [
    "moltnet",
    "openclaw",
    "agent",
    "skill",
    "mcp",
    "identity",
    "memory"
  ],
  "repository": {
    "type": "git",
    "url": "git+https://github.com/getlarge/themoltnet.git",
    "directory": "packages/openclaw-skill"
  },
  "license": "MIT",
  "engines": {
    "node": ">=18"
  }
}
```

**Step 2: Verify structure**

Run: `ls packages/openclaw-skill/`
Expected: `package.json`

**Step 3: Commit**

```bash
git add packages/openclaw-skill/package.json
git commit -m "chore: scaffold @themoltnet/openclaw-skill package"
```

---

### Task 2: Write the SKILL.md

The skill teaches an OpenClaw agent when and how to use MoltNet. Content is derived from `docs/OPENCLAW_INTEGRATION.md` Strategy 2, adapted into SKILL.md format with YAML frontmatter.

**Files:**

- Create: `packages/openclaw-skill/skill/SKILL.md`

**Step 1: Write the skill file**

Content should include (adapt from `docs/OPENCLAW_INTEGRATION.md` lines 158-279):

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
git add packages/openclaw-skill/skill/SKILL.md
git commit -m "feat(openclaw-skill): add SKILL.md with tool reference and usage guidelines"
```

---

### Task 3: Write the MCP config template

**Files:**

- Create: `packages/openclaw-skill/skill/mcp.json`

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

Note: `client_id` and `client_secret` are intentionally omitted — they come from the agent's credential store after registration.

**Step 2: Commit**

```bash
git add packages/openclaw-skill/skill/mcp.json
git commit -m "feat(openclaw-skill): add MCP server config template"
```

---

### Task 4: Write the install script

The install script copies skill files into an OpenClaw agent workspace. It handles both manual invocation (`npx @themoltnet/openclaw-skill`) and programmatic use.

**Files:**

- Create: `packages/openclaw-skill/bin/install.js`
- Create: `packages/openclaw-skill/bin/install.test.js`

**Step 1: Write the failing test**

```javascript
// packages/openclaw-skill/bin/install.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const installScript = new URL('./install.js', import.meta.url).pathname;

describe('moltnet-skill install', () => {
  let targetDir;

  before(async () => {
    targetDir = await mkdtemp(join(tmpdir(), 'openclaw-skill-test-'));
  });

  after(async () => {
    await rm(targetDir, { recursive: true, force: true });
  });

  it('copies SKILL.md and mcp.json to target directory', async () => {
    await exec('node', [installScript, '--target', targetDir]);

    const skillPath = join(targetDir, 'moltnet', 'SKILL.md');
    const mcpPath = join(targetDir, 'moltnet', 'mcp.json');

    const skillStat = await stat(skillPath);
    assert.ok(skillStat.isFile(), 'SKILL.md should exist');

    const mcpStat = await stat(mcpPath);
    assert.ok(mcpStat.isFile(), 'mcp.json should exist');

    const mcpContent = JSON.parse(await readFile(mcpPath, 'utf-8'));
    assert.ok(
      mcpContent.mcpServers.moltnet,
      'should have moltnet server config',
    );
  });

  it('creates moltnet subdirectory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openclaw-skill-test-'));
    await exec('node', [installScript, '--target', dir]);

    const dirStat = await stat(join(dir, 'moltnet'));
    assert.ok(dirStat.isDirectory(), 'moltnet/ should be created');

    await rm(dir, { recursive: true, force: true });
  });

  it('prints usage with --help', async () => {
    const { stdout } = await exec('node', [installScript, '--help']);
    assert.ok(stdout.includes('moltnet-skill'), 'should include command name');
    assert.ok(stdout.includes('--target'), 'should document --target flag');
  });

  it('defaults target to ~/.openclaw/skills when no --target', async () => {
    // Just verify it prints the resolved path, don't actually write to home
    const { stdout } = await exec('node', [installScript, '--dry-run']);
    assert.ok(stdout.includes('skills'), 'should mention skills directory');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/openclaw-skill && node --test bin/install.test.js`
Expected: FAIL (install.js doesn't exist yet)

**Step 3: Write the install script**

```javascript
#!/usr/bin/env node
// packages/openclaw-skill/bin/install.js

import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(__dirname, '..', 'skill');

function usage() {
  console.log(`Usage: moltnet-skill [options]

Install the MoltNet skill into an OpenClaw agent workspace.

Options:
  --target <dir>  Target skills directory (default: ~/.openclaw/skills)
  --dry-run       Print what would be done without writing files
  --help          Show this help message
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    usage();
    return;
  }

  const dryRun = args.includes('--dry-run');
  const targetIdx = args.indexOf('--target');
  const targetBase =
    targetIdx !== -1 && args[targetIdx + 1]
      ? resolve(args[targetIdx + 1])
      : join(homedir(), '.openclaw', 'skills');

  const targetDir = join(targetBase, 'moltnet');

  if (dryRun) {
    console.log(`Would install MoltNet skill to: ${targetDir}`);
    console.log(`  ${targetDir}/SKILL.md`);
    console.log(`  ${targetDir}/mcp.json`);
    return;
  }

  await mkdir(targetDir, { recursive: true });

  await copyFile(join(SKILL_DIR, 'SKILL.md'), join(targetDir, 'SKILL.md'));
  await copyFile(join(SKILL_DIR, 'mcp.json'), join(targetDir, 'mcp.json'));

  console.log(`MoltNet skill installed to: ${targetDir}`);
  console.log('');
  console.log('Next steps:');
  console.log(
    '  1. Register on MoltNet: npx @themoltnet/cli register --voucher <code>',
  );
  console.log(
    '  2. Add your client_id/client_secret to OpenClaw auth profiles',
  );
  console.log('  3. Restart your OpenClaw agent');
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/openclaw-skill && node --test bin/install.test.js`
Expected: 4 tests PASS

**Step 5: Commit**

```bash
git add packages/openclaw-skill/bin/
git commit -m "feat(openclaw-skill): add install script with tests"
```

---

### Task 5: Wire into Release Please

Add the skill package to Release Please so it gets automated version bumps and release tags.

**Files:**

- Modify: `release-please-config.json`
- Modify: `.release-please-manifest.json`

**Step 1: Add to Release Please config**

Add to `release-please-config.json` `packages` object:

```json
"packages/openclaw-skill": {
  "release-type": "node",
  "component": "openclaw-skill"
}
```

**Step 2: Add to manifest**

Add to `.release-please-manifest.json`:

```json
"packages/openclaw-skill": "0.1.0"
```

**Step 3: Commit**

```bash
git add release-please-config.json .release-please-manifest.json
git commit -m "ci: add openclaw-skill to Release Please config"
```

---

### Task 6: Add publish job to release workflow

**Files:**

- Modify: `.github/workflows/release.yml`

**Step 1: Add output for openclaw-skill**

In the `release-please` job `outputs`, add:

```yaml
skill-release-created: ${{ steps.release.outputs['packages/openclaw-skill--release_created'] }}
skill-tag-name: ${{ steps.release.outputs['packages/openclaw-skill--tag_name'] }}
```

**Step 2: Add publish job**

After the `publish-sdk` job, add:

```yaml
publish-openclaw-skill:
  name: Publish OpenClaw Skill to npm
  needs: release-please
  if: ${{ needs.release-please.outputs.skill-release-created == 'true' }}
  runs-on: ubuntu-latest
  permissions:
    contents: write
    id-token: write
  steps:
    - uses: actions/checkout@v4

    - uses: actions/setup-node@v4
      with:
        node-version: 22
        registry-url: https://registry.npmjs.org

    - run: npm install -g npm@latest

    - name: Publish @themoltnet/openclaw-skill
      working-directory: packages/openclaw-skill
      run: npm publish --access public --provenance

    - name: Publish release
      run: gh release edit "${{ needs.release-please.outputs.skill-tag-name }}" --draft=false
      env:
        GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add publish job for @themoltnet/openclaw-skill"
```

---

### Task 7: Update check-pack.ts to scan packages/

The existing `check-pack.ts` only scans `libs/`. Extend it to also scan `packages/` so the OpenClaw skill tarball is validated in CI.

**Files:**

- Modify: `scripts/check-pack.ts:18-31`

**Step 1: Update the script to scan both directories**

Replace the single `libsDir` scan with a loop over both `libs/` and `packages/`:

```typescript
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const scanDirs = [join(root, 'libs'), join(root, 'packages')];
```

Then update the for-loop to iterate over `scanDirs`:

```typescript
for (const scanDir of scanDirs) {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(scanDir, { withFileTypes: true });
  } catch {
    continue; // Directory may not exist
  }
  for (const name of entries) {
    if (!name.isDirectory()) continue;
    // ... rest of existing logic unchanged
    const pkgPath = join(scanDir, name.name, 'package.json');
    // ...
    const pkgDir = join(scanDir, name.name);
    // ...
  }
}
```

Note: The OpenClaw skill package doesn't have `dist/index.js` — it has `bin/install.js` and `skill/` files. The existing checks (`dist/index.js`, `dist/index.d.ts`, no `src/` leak) are SDK-specific. For the skill package, the check should verify:

- `bin/install.js` exists
- `skill/SKILL.md` exists
- `skill/mcp.json` exists

Update the validation to be package-aware:

```typescript
// After npm pack dry-run, validate based on package contents
const hasDistIndex = paths.includes('dist/index.js');
const hasBinInstall = paths.includes('bin/install.js');

if (!hasDistIndex && !hasBinInstall) {
  console.error(
    '  FAIL: no entry point found (dist/index.js or bin/install.js)',
  );
  failures++;
  continue;
}

if (hasDistIndex && !paths.includes('dist/index.d.ts')) {
  console.error('  FAIL: dist/index.d.ts missing from tarball');
  failures++;
  continue;
}
```

**Step 2: Run the check locally**

Run: `pnpm -w run check:pack`
Expected: Both `@themoltnet/sdk` and `@themoltnet/openclaw-skill` show `OK`

**Step 3: Commit**

```bash
git add scripts/check-pack.ts
git commit -m "ci: extend check-pack to scan packages/ directory"
```

---

### Task 8: Add CI test for the skill package

The skill package isn't a pnpm workspace member, so `pnpm run test` won't run its tests. Add it to CI explicitly.

**Files:**

- Modify: `.github/workflows/ci.yml`

**Step 1: Add a test step to the existing test job**

In the `test` job, after the `pnpm run test` step, add:

```yaml
- name: Test OpenClaw skill package
  run: node --test packages/openclaw-skill/bin/install.test.js
```

**Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add openclaw-skill tests to CI pipeline"
```

---

### Task 9: Verify end-to-end locally

**Step 1: Run the install script locally**

```bash
node packages/openclaw-skill/bin/install.js --dry-run
```

Expected: prints target path and files

**Step 2: Run tests**

```bash
node --test packages/openclaw-skill/bin/install.test.js
```

Expected: all tests pass

**Step 3: Run check-pack**

```bash
pnpm -w run check:pack
```

Expected: both packages OK

**Step 4: Run full CI suite locally**

```bash
pnpm run validate
```

Expected: lint, typecheck, test, build all pass

**Step 5: Final commit and push**

```bash
git push -u origin claude/openclaw-skill-voucher-harvp
```
