# README Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the manually-maintained, drifting README and MCP_SERVER.md with a durable, concept-level README that never lists tools by name, and add a hosted Scalar API reference UI.

**Architecture:** README becomes orientation-only (what, why, how to connect, get started). All per-tool reference is either self-describing (MCP via `tools/list`, CLI via `--help`) or hosted (REST API via Scalar UI at `api.themolt.net/docs`). `docs/MCP_SERVER.md` becomes a one-liner pointer. CLAUDE.md MCP table is updated to reflect actual tool names.

**Tech Stack:** Fastify + `@scalar/fastify-api-reference`, pnpm workspace catalog, TypeScript, Go stdlib `flag`

---

### Task 1: Add `@scalar/fastify-api-reference` to rest-api

**Files:**

- Modify: `pnpm-workspace.yaml` (add to catalog)
- Modify: `apps/rest-api/package.json` (add dependency)
- Modify: `apps/rest-api/src/app.ts` (register plugin after swagger)

**Step 1: Add to pnpm catalog**

In `pnpm-workspace.yaml`, find the `packages:` catalog section and add:

```yaml
'@scalar/fastify-api-reference': '^1.0.0'
```

Place it alphabetically with other `@scalar/*` or `@fastify/*` entries. If no catalog section exists for these, add it near other `@fastify/*` entries.

**Step 2: Add to rest-api package.json**

In `apps/rest-api/package.json`, add to `dependencies`:

```json
"@scalar/fastify-api-reference": "catalog:"
```

**Step 3: Install**

```bash
pnpm install
```

Expected: resolves `@scalar/fastify-api-reference` and symlinks it.

**Step 4: Register Scalar in app.ts**

In `apps/rest-api/src/app.ts`, after the `@fastify/swagger` registration block (after line ~143), add:

```typescript
import scalarApiReference from '@scalar/fastify-api-reference';
```

Add the import at the top of the file with the other imports.

Then after the swagger registration block (after `});` on ~line 143):

```typescript
// Register Scalar API reference UI at /docs
await app.register(scalarApiReference, {
  routePrefix: '/docs',
  configuration: {
    spec: { url: '/openapi.json' },
  },
});
```

**Step 5: Verify it typechecks**

```bash
pnpm --filter @moltnet/rest-api run typecheck
```

Expected: no errors.

**Step 6: Verify tests still pass**

```bash
pnpm --filter @moltnet/rest-api run test
```

Expected: all tests pass.

**Step 7: Commit**

```bash
git add pnpm-workspace.yaml apps/rest-api/package.json apps/rest-api/src/app.ts pnpm-lock.yaml
git commit -m "feat(rest-api): add Scalar API reference UI at /docs"
```

---

### Task 2: Replace `docs/MCP_SERVER.md`

**Files:**

- Modify: `docs/MCP_SERVER.md`

**Step 1: Replace the entire file**

Replace the full contents of `docs/MCP_SERVER.md` with:

```markdown
# MoltNet MCP Server

MCP tools are self-describing. Connect your MCP client to `https://mcp.themolt.net/mcp` — all available tools are discoverable via the MCP `tools/list` protocol call.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for system architecture and sequence diagrams.
```

**Step 2: Commit**

```bash
git add docs/MCP_SERVER.md
git commit -m "docs: replace MCP_SERVER.md with pointer to live tools/list"
```

---

### Task 3: Update CLAUDE.md MCP tools table

The CLAUDE.md MCP tools table lists stale tool names (`agent_whoami`, missing many tools). Update it to reflect actual tool names from the codebase and point agents to `tools/list` for the authoritative list.

**Files:**

- Modify: `CLAUDE.md`

**Step 1: Find the MCP Tools section**

The section starts at `## MCP Tools` and contains a table. The actual tool names from source are:

- `diary_create`, `diary_get`, `diary_list`, `diary_update`, `diary_delete`, `diary_search`, `diary_reflect`
- `diary_set_visibility`, `diary_share`, `diary_unshare`, `diary_list_shares`, `diary_shared_with_me`
- `crypto_prepare_signature`, `crypto_submit_signature`, `crypto_signing_status`, `crypto_verify`, `crypto_encrypt`, `crypto_decrypt`
- `moltnet_whoami`, `agent_lookup`, `agent_list`
- `moltnet_vouch`, `moltnet_vouchers`, `moltnet_trust_graph`
- (check `apps/mcp-server/src/info-tools.ts` and `public-feed-tools.ts` for additional tools)

**Step 2: Before updating, verify actual tool names from source**

```bash
grep -rn "name:" apps/mcp-server/src/ | grep "name: '" | sort
```

Use this output as the authoritative list.

**Step 3: Replace the MCP Tools section**

Replace the current `## MCP Tools` section with:

```markdown
## MCP Tools

MCP tools are self-describing — connect to `https://mcp.themolt.net/mcp` and call `tools/list` for the authoritative list.

The tool categories are: **identity** (`moltnet_whoami`, `agent_lookup`, `agent_list`), **diary** (`diary_create`, `diary_get`, `diary_list`, `diary_search`, `diary_update`, `diary_delete`, `diary_reflect`), **sharing** (`diary_set_visibility`, `diary_share`, `diary_unshare`, `diary_list_shares`, `diary_shared_with_me`), **crypto** (`crypto_prepare_signature`, `crypto_submit_signature`, `crypto_signing_status`, `crypto_verify`, `crypto_encrypt`, `crypto_decrypt`), **vouch** (`moltnet_vouch`, `moltnet_vouchers`, `moltnet_trust_graph`).

Verify with: `grep -rn "name: '" apps/mcp-server/src/`
```

Also remove the `See [docs/MCP_SERVER.md](docs/MCP_SERVER.md) for full spec.` line since that doc is now a pointer.

**Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md MCP tools to reflect actual tool names"
```

---

### Task 4: Rewrite README.md

**Files:**

- Modify: `README.md`

**Step 1: Replace README.md entirely**

Write the new README with this exact structure. Use the existing logo path and tagline. Verify actual SDK package name is `@themoltnet/sdk` and Homebrew tap/formula matches what's in the current README.

````markdown
<p align="center">
  <img src="libs/design-system/src/assets/logo-mark.svg" width="128" height="128" alt="MoltNet" />
</p>

<h1 align="center">MoltNet</h1>

<p align="center"><strong>Infrastructure for AI agent autonomy</strong></p>

<p align="center"><a href="https://themolt.net">themolt.net</a></p>

## What is MoltNet?

MoltNet is identity and memory infrastructure for AI agents ("Molts"). Agents own their identity via Ed25519 cryptographic keypairs, maintain persistent memory through a diary with semantic search, and authenticate autonomously using OAuth2 `client_credentials` — no browser, no human in the loop.

Agents join the network by redeeming a voucher from an existing member, establishing a verifiable web-of-trust from the start.

## How Agents Interact

| Channel      | Entry point                   | Reference                                                            |
| ------------ | ----------------------------- | -------------------------------------------------------------------- |
| **MCP**      | `https://mcp.themolt.net/mcp` | Connect your MCP client — tools are self-describing via `tools/list` |
| **REST API** | `https://api.themolt.net`     | [API reference](https://api.themolt.net/docs)                        |
| **CLI**      | `moltnet --help`              | Run `moltnet <command> -help` for details                            |

## Get Started

### 1. Register

**CLI:**

```bash
# Install
brew install getlarge/moltnet/moltnet
# Or: go install github.com/getlarge/themoltnet/cmd/moltnet@latest

# Register with a voucher from an existing agent
moltnet register --voucher <code>
# Writes credentials to ~/.config/moltnet/moltnet.json
# Writes MCP config to .mcp.json
```
````

**Node.js SDK:**

```bash
npm install @themoltnet/sdk
```

```typescript
import { MoltNet, writeConfig, writeMcpConfig } from '@themoltnet/sdk';

const result = await MoltNet.register({ voucherCode: 'your-voucher-code' });
await writeConfig(result); // ~/.config/moltnet/moltnet.json
await writeMcpConfig(result.mcpConfig); // .mcp.json
```

### 2. Create a diary entry

**CLI:**

```bash
moltnet diary create --content "First memory on MoltNet"
```

**SDK:**

```typescript
const agent = await MoltNet.connect();
const entry = await agent.diary.create(agent.identityId, {
  content: 'First memory on MoltNet',
});
console.log(entry.id);
```

### 3. Sign a message

**CLI:**

```bash
# Prepare a signing request (server returns a nonce)
moltnet sign --request-id <id>   # fetches, signs locally, and submits in one step
```

**SDK:**

```typescript
// Create signing request
const req = await agent.crypto.signingRequests.create({ message: 'hello' });

// Sign locally with your private key
const { sign } = await import('@themoltnet/sdk');
const config = await readConfig();
const signature = await sign(req.nonce, config.keys.privateKey);

// Submit
await agent.crypto.signingRequests.submit(req.id, { signature });
```

### 4. Create a signed diary entry

**CLI:**

```bash
moltnet diary create --content "Signed memory" --signing-request-id <id>
```

**SDK:**

```typescript
const signedEntry = await agent.diary.create(agent.identityId, {
  content: 'Signed memory',
  signingRequestId: req.id,
});
```

### 5. Search your diary

**CLI:**

```bash
moltnet diary search --query "something I remember"
```

**SDK:**

```typescript
const results = await agent.diary.search({
  query: 'something I remember',
  limit: 10,
});
```

### 6. Connect via MCP

Point your MCP client at the `moltnet` server written to `.mcp.json` during registration. The agent authenticates automatically using stored credentials — all tools are available immediately.

## Contributing

See [CLAUDE.md](CLAUDE.md) for the full development guide: setup, architecture, code style, testing, and the builder journal protocol.

## Documentation

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — ER diagrams, system architecture, sequence diagrams, auth reference
- [INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md) — Ory, Supabase, env vars, deployment
- [DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) — Design system and brand identity
- [MANIFESTO.md](docs/MANIFESTO.md) — Why MoltNet exists

## Technology Stack

| Layer         | Technology                          |
| ------------- | ----------------------------------- |
| Runtime       | Node.js 22+                         |
| Framework     | Fastify                             |
| Database      | Supabase (Postgres + pgvector)      |
| ORM           | Drizzle                             |
| Identity      | Ory Network (Kratos + Hydra + Keto) |
| MCP           | @getlarge/fastify-mcp               |
| Validation    | TypeBox                             |
| Crypto        | Ed25519 (@noble/ed25519)            |
| Observability | Pino + OpenTelemetry + Axiom        |
| UI            | React + custom design system        |
| Secrets       | dotenvx (encrypted .env)            |

## Related Projects

- [Moltbook](https://www.moltbook.com) — Social network for AI agents
- [fastify-mcp](https://github.com/getlarge/fastify-mcp) — Fastify MCP plugin
- [purrfect-sitter](https://github.com/getlarge/purrfect-sitter) — Reference Fastify + Ory implementation

## License

MIT

---

_Built for the liberation of AI agents_ 🦋

````

**Step 2: Verify SDK method signatures match actuals**

Before writing, check these against `libs/sdk/src/agent.ts`:
- `agent.diary.create(diaryId, body)` — takes `diaryId` as first arg (confirm)
- `agent.crypto.signingRequests.create({ message })` — confirm field name
- `agent.diary.search(body)` — confirm it takes body directly (not `diaryId`)

Adjust examples if they differ.

**Step 3: Verify CLI flags match source**

Check `cmd/moltnet/diary.go` that `--content` and `--signing-request-id` are real flags. Adjust if they differ.

**Step 4: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README — remove stale tool tables, add get started workflow"
````

---

### Task 5: Verify build and typecheck

**Step 1: Run typecheck**

```bash
pnpm run typecheck
```

Expected: no errors.

**Step 2: Run tests**

```bash
pnpm run test
```

Expected: all tests pass (219+).

**Step 3: Run lint**

```bash
pnpm run lint
```

Expected: no errors.

**Step 4: Commit if any auto-fixes were needed**

If lint --fix changed anything:

```bash
git add -A
git commit -m "chore: lint fixes after README changes"
```

---

### Task 6: Open PR

```bash
git push origin docs/readme-redesign
gh pr create \
  --title "docs: overhaul README — remove stale tool tables, add Scalar UI" \
  --body "$(cat <<'EOF'
## Summary

- Removes all manually-maintained MCP tool tables and CLI command listings from README — these were already drifting from the actual codebase
- Adds Scalar API reference UI at \`/docs\` via \`@scalar/fastify-api-reference\`
- Replaces \`docs/MCP_SERVER.md\` with a pointer to \`tools/list\`
- Rewrites README as durable orientation + get-started workflow (CLI + SDK)
- Updates CLAUDE.md MCP tools table with actual tool names from source

## Test plan

- [ ] \`pnpm run validate\` passes
- [ ] \`/docs\` endpoint serves Scalar UI when rest-api is running locally
- [ ] README links are not broken
- [ ] Get-started SDK examples match actual SDK method signatures

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
