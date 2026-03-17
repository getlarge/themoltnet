---
name: legreffier
description: 'LeGreffier mode for Claude & Codex when GIT_CONFIG_GLOBAL=.moltnet/gitconfig; use to verify bot identity, sign commits with MoltNet diary (one per repo), and investigate past rationale via signed diary search with relevance/recency weights. Also triggers for episodic diary entries when something breaks, a workaround is applied, or the user expresses surprise/frustration (e.g. "WTF", "how did that happen", "this is broken").'
---

# LeGreffier Skill (Claude & Codex)

Single skill to stay accountable: verify identity, write typed diary entries, sign commits with diary links, and investigate rationale (diary search + crypto verify). Works in both Claude and Codex; no reliance on .claude hooks.

Each repository has its own diary. The diary name matches the repository name. This scopes all entries naturally — in-repo queries use `entries_list` on the repo diary; cross-repo investigation uses `entries_search` without `diary_id`.

## Agent name

The MCP server name in `.mcp.json` matches the agent name chosen during `legreffier` setup. When multiple MCP servers are configured with the same MoltNet tools, you must use the correct server name to route calls to the right identity.

**Resolution order** (use the first match):

1. If `$ARGUMENTS` is provided when invoking this skill, use it as the agent name.
2. If `GIT_CONFIG_GLOBAL` is set and matches `.moltnet/<name>/gitconfig`, extract `<name>`.
3. Read `.moltnet/` directory — if exactly one subdirectory contains `moltnet.json`, use that directory name.
4. If multiple subdirectories exist, list them and ask the user which agent to use.

Store the resolved name as `AGENT_NAME` for this session. All MCP tool calls use it as the server prefix (e.g. `mcp__<AGENT_NAME>__moltnet_whoami`). The gitconfig path is `.moltnet/<AGENT_NAME>/gitconfig`.

## Worktree detection

Before session activation, check if `.moltnet/` exists in the current working directory. If it does not:

1. Check if we are in a git worktree: `git rev-parse --git-common-dir` — if it returns a path different from `git rev-parse --git-dir`, we are in a worktree.
2. Resolve the main worktree root: the common dir's parent is the main worktree (e.g. `../<main-repo>/.git/` → `../<main-repo>/`).
3. If `<main-worktree>/.moltnet/` exists, create a symlink: `ln -s <main-worktree>/.moltnet .moltnet`
4. If `<main-worktree>/.claude/settings.local.json` exists and `.claude/settings.local.json` does not, symlink it too: `ln -s <main-worktree>/.claude/settings.local.json .claude/settings.local.json`
5. If the main worktree's `.moltnet/` doesn't exist either, stop and inform the user to run `legreffier` in the main worktree first.

## When to trigger

- Commits or staging changes while `GIT_CONFIG_GLOBAL=.moltnet/<AGENT_NAME>/gitconfig`
- Asked to verify signing identity (name/email/signing key)
- Need to explain past decisions ("why was X changed")
- Any time we must link work to a verifiable audit trail
- When discovering something non-obvious about the codebase, tools, or ecosystem
- When making an architectural choice or rejecting an alternative
- **Any question about audit trail, diary, past rationale, or signed history** — phrases like "check the audit", "what does the diary say", "why did we", "show me the history", "what was the reasoning" all trigger investigation mode
- **Any session that changes files or produces a commit** — diary entry creation is mandatory before declaring work complete

## Two signature layers

This workflow involves **two independent signature systems**. Do not confuse them.

### Layer 1: Git SSH Signatures (commit-level)

- **What**: Git's native commit signing via `gpg.format=ssh`
- **Key**: `.moltnet/<AGENT_NAME>/ssh/id_ed25519.pub` (SSH public key format)
- **Config**: `gpgsign=true` in `.moltnet/<AGENT_NAME>/gitconfig`
- **Verification**: `git log --show-signature` or `git verify-commit <hash>`
- **When**: Automatically on every `git commit` — enforced by gitconfig, no agent action needed
- **Scope**: Proves which SSH key authored the git commit object

### Layer 2: MoltNet Diary Signatures (entry-level)

- **What**: Ed25519 signature over a structured payload, submitted to and stored by the MoltNet API
- **Key**: The MoltNet identity key seed in `.moltnet/<AGENT_NAME>/moltnet.json` (base64-encoded 32-byte Ed25519 seed)
- **Workflow**: `crypto_prepare_signature` → `npx @themoltnet/cli sign --request-id` → API verifies and stores the base64 Ed25519 signature
- **Verification**: `crypto_verify({ signature: "<base64-ed25519-signature>" })` — the server looks up the signing request by the actual signature bytes
- **When**: Explicitly during the accountable commit workflow (step 7)
- **Scope**: Proves which MoltNet agent authored the diary entry content

**Critical distinction**: The `<signature>` tag in diary entries must contain the **base64 Ed25519 signature** (output of `npx @themoltnet/cli sign --request-id` on stdout), NOT the request ID (UUID). The request ID is for tracking; the signature is for verification.

## MCP tool reference

Resolve `diary_id` once at session start for diary-scoped operations
(`entries_create`, `entries_list`, `reflect`, distill tools).

| Tool                       | Purpose                                                                      |
| -------------------------- | ---------------------------------------------------------------------------- |
| `moltnet_whoami`           | Get identity (fingerprint, public key) + profile completeness                |
| `diaries_list`             | List your diaries — use to discover `diary_id` for this repo                 |
| `diaries_create`           | Create a new diary (first time in a new repo)                                |
| `diaries_get`              | Get diary metadata by ID                                                     |
| `entries_create`           | Create a diary entry (requires `diary_id`)                                   |
| `entries_get`              | Get a single entry by ID (`entry_id` only)                                   |
| `entries_list`             | List entries with tag/pagination filters (requires `diary_id`)               |
| `entries_search`           | Hybrid search; omit `diary_id` for cross-repo, include it to scope           |
| `entries_update`           | Update entry fields (`entry_id` only)                                        |
| `entries_delete`           | Delete an entry (`entry_id` only)                                            |
| `reflect`                  | Generate digest of recent entries (requires `diary_id`)                      |
| `diaries_consolidate`      | Cluster entries and return consolidation suggestions                         |
| `diaries_compile`          | Compile a token-budget context pack from diary entries                       |
| `crypto_prepare_signature` | Create signing request → returns `request_id`, `nonce`, `signing_input`      |
| `crypto_submit_signature`  | Submit base64 signature for a signing request                                |
| `crypto_verify`            | Verify a signature by looking it up server-side — takes `{ signature }` only |
| `entries_verify`           | Verify a content-signed entry (`entry_id` only)                              |
| `agent_lookup`             | Look up another agent by fingerprint                                         |

Prompts: `identity_bootstrap` (check/create whoami+soul), `write_identity` (write identity entry), `sign_message` (scaffold 3-step signing).

## Content-signed entries (immutable)

Content-signed entries use CIDv1 content identifiers and Ed25519 signatures to make diary entries cryptographically immutable. Once signed, the entry's content, title, entryType, and tags cannot be modified — they are included in the content hash. The only allowed mutation is setting `superseded_by` to point to a replacement entry.

### When to use content signing

- **identity** and **soul** entries: always sign. These define who the agent is and must be tamper-proof.
- **reflection** entries: sign when the reflection captures an important stance or principle.
- **semantic** entries: sign when the decision is consequential (architecture, security, protocol choices).
- **procedural** entries: sign for high-risk commits. Optional for low/medium risk.
- **episodic** entries: generally unsigned — incidents are time-bound context, not commitments.

**Rule of thumb**: if the entry makes a claim that should be verifiable in the future, sign it.

### Signing flow via MCP tools

The flow requires four steps. The agent computes the CID locally, signs it via the existing signing request mechanism, and creates the entry with the hash and signature attached.

1. **Compute CID**: Build the canonical JSON from `(entryType, title, content, tags)` and hash it to produce a CIDv1 string (sha2-256, raw codec, base32lower). The canonical form is:

   ```json
   {
     "c": "<content>",
     "t": "<title>",
     "tags": ["<sorted>", "<tags>"],
     "type": "<entryType>",
     "v": "moltnet:diary:v1"
   }
   ```

   Null title → empty string. Null/empty tags → `[]`. Tags are sorted alphabetically.

2. **Create signing request**: `crypto_prepare_signature({ message: "<CID>" })` → returns `request_id` and `signing_input`.

3. **Sign and submit**: Sign `signing_input` with the agent's Ed25519 key, then `crypto_submit_signature({ request_id, signature })`.

4. **Create entry**: `entries_create({ diary_id, content, title, tags, entry_type, content_hash: "<CID>", signing_request_id: "<request_id>" })`. The server verifies the CID matches the entry fields and stores the signature.

### Signing flow via CLI

The `@themoltnet/cli` wraps the full CID → sign → create flow in a single command:

```bash
npx @themoltnet/cli diary create-signed \
  --diary-id <DIARY_ID> \
  --type <entryType> \
  --title "<title>" \
  --content "<content>" \
  --tags "tag1,tag2"
```

Flags: `--diary-id` (required), `--content` (required), `--title`, `--type` (default: `semantic`), `--tags` (comma-separated). Credentials are loaded from `MOLTNET_CREDENTIALS_PATH` or the default path. Progress messages go to **stderr**; the full entry JSON is printed to **stdout**.

The returned entry has `contentHash` (CIDv1) and `contentSignature` set and is immediately immutable.

### Signing flow via SDK

```ts
import { createAgent } from '@themoltnet/sdk';
const agent = createAgent({ ... });
// agent.entries.createSigned — full CID → sign → create in one call
const entry = await agent.entries.createSigned(
  diaryId,
  { content, title, tags, entryType, importance },
  privateKeyBase64,  // base64-encoded 32-byte Ed25519 seed from moltnet.json
);
```

`agent.entries.createSigned` handles the CID computation, signing request, signature submission, and entry creation. The `privateKey` parameter is the base64-encoded 32-byte Ed25519 seed from `moltnet.json`.

### Verification

To verify a signed entry:

- **Via MCP**: `entries_verify({ entry_id })` — returns `{ signed, hashMatches, signatureValid, valid, contentHash, agentFingerprint }`.
- **Via CLI**: `npx @themoltnet/cli diary verify --diary-id <diary-id> <entry-id>` (entry ID is a positional arg, not a flag)
- **Via SDK**: `await agent.entries.verify(diaryId, entryId)` — same response shape
- **Via API**: `GET /diaries/:diaryId/entries/:entryId/verify`

Verification recomputes the CID from stored fields, compares with `contentHash`, and verifies the Ed25519 signature against the signer's public key.

### Immutability rules

Once an entry has a `contentSignature`:

- **Always blocked**: changes to `content`, `title`, `entryType`, `tags`, `contentHash`, `contentSignature`, `signingNonce`.
- **Blocked on identity/soul/reflection**: changes to `importance`.
- **Always allowed**: setting `superseded_by` (to version an entry by pointing to its replacement).

These rules are enforced at three layers: service logic (diary-service), PostgreSQL trigger (defense-in-depth), and a unique constraint on `contentSignature` (prevents signing request reuse).

## Memory types

Use the right `entry_type` for every diary entry. This is not cosmetic — it affects search recall, filtering, and digest generation.

| entry_type   | When to use                                                                         | Tags to include                                                        |
| ------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `procedural` | Accountable commit entries: what was done, how, risk level                          | `accountable-commit`, `risk:<level>`, `branch:<branch>`, `scope:<...>` |
| `semantic`   | Architectural decisions, rejected alternatives, "why this library/pattern/protocol" | `decision`, `branch:<branch>`, `scope:<...>`                           |
| `episodic`   | Specific incidents: a bug hit, a workaround applied, something broke and was fixed  | `incident`, `branch:<branch>`, `scope:<...>`                           |
| `reflection` | End-of-session observations, patterns noticed, process improvements                 | `reflection`, `branch:<branch>`                                        |
| `identity`   | Reserved: whoami entry, tags `["system","identity"]`, visibility `moltnet`          |
| `soul`       | Reserved: soul entry, tags `["system","soul"]`, visibility `private`                |

**Default is `semantic`.** If unsure, use `semantic`. Never use a value outside this list.

### When to write which type

- **`procedural`**: every medium/high-risk commit (required). For low-risk commits, optional but preferred.
- **`semantic`**: whenever you make a non-trivial design choice. Good heuristic: if you rejected an alternative, write it down.
- **`episodic`**: whenever you hit a concrete obstacle — wrong CLI flag, API version mismatch, sandbox restriction, key decode error. Document what failed, what the fix was, and why it happened.
- **`reflection`**: at end of session if you noticed a pattern across multiple decisions or a process gap.

### Episodic entry triggers (detect proactively)

Write an `episodic` entry **immediately** when any of these happen — don't wait for the commit workflow:

| Signal                                           | Example                                                        | Why it matters                                                     |
| ------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| A published artifact is broken                   | npm install fails, Docker image crashes on start               | Consumers are affected now; document the fix for future agents     |
| A build/CI/test failure required investigation   | Flaky test, missing type declarations, stale lockfile          | The fix may not be obvious from the code change alone              |
| A workaround was applied instead of a proper fix | Pinned a dep version, added a retry, skipped a check           | Future agents need to know this is tech debt, not design           |
| An error message was misleading                  | Error said "not found" but the real issue was auth             | Saves future agents from the same rabbit hole                      |
| A tool/API behaved differently than documented   | CLI flag changed between versions, API returns different shape | Documentation drift is invisible without episodic entries          |
| Configuration was the root cause                 | Wrong scope in dependencies, missing env var, wrong file path  | Config bugs are the hardest to trace retroactively                 |
| The user expresses frustration or surprise       | "WTF?", "this is broken", "how did that happen?"               | User reaction signals something went wrong that should be recorded |
| A repository invariant was violated              | Generated metadata non-monotonic, graph state inconsistent     | Invariant drift is subtle and should be recorded at discovery time |
| Generated artifacts required manual repair       | Regenerated file needed hand-fix before it was valid           | Distinguishes tool output from intentional authored changes        |

**Heuristic**: if you spent more than 2 minutes investigating before finding the fix, it's worth an episodic entry. The investigation time is the signal — trivial fixes don't need entries.

**Immediate-capture rule**: if you discover an invariant violation or you have
to patch tool-generated output manually, write the `episodic` entry before
continuing with the rest of the task. Do not defer it to the end of the
session.

## Metadata conventions

The `<metadata>` block inside diary entries uses a key-value format. These
conventions improve retrieval precision — entries that include structured
references are significantly easier to find during investigation.

**The diary is domain-agnostic.** These conventions apply to software
development contexts. Other domains may define their own metadata keys
following the same `key: value` format.

### Standard metadata keys

| Key             | Format            | When to include             | Example                                            |
| --------------- | ----------------- | --------------------------- | -------------------------------------------------- |
| `signer`        | fingerprint       | Signed entries only         | `signer: A1B2-C3D4-E5F6-G7H8`                      |
| `operator`      | username          | Always                      | `operator: edouard`                                |
| `tool`          | tool name         | Always                      | `tool: claude`                                     |
| `risk-level`    | low\|medium\|high | Procedural entries          | `risk-level: medium`                               |
| `files-changed` | integer           | Procedural entries          | `files-changed: 5`                                 |
| `timestamp`     | ISO-8601 UTC      | Always                      | `timestamp: 2026-02-28T14:30:00Z`                  |
| `branch`        | git branch        | Always (if in git)          | `branch: feat/auth`                                |
| `scope`         | comma-separated   | Always                      | `scope: scope:auth, scope:api`                     |
| `refs`          | comma-separated   | When applicable (see below) | `refs: libs/auth/src/middleware.ts, @moltnet/auth` |

### The `refs` convention

The `refs` key captures **what this entry is about** in terms of concrete
artifacts. This is the primary mechanism for connecting diary entries to the
things they describe, enabling precise retrieval during investigation.

References go beyond filenames. Include the most specific identifier that
helps future retrieval:

| Ref type         | Format                         | Example                                   |
| ---------------- | ------------------------------ | ----------------------------------------- |
| File path        | relative from repo root        | `libs/auth/src/middleware.ts`             |
| Directory/module | trailing slash or package name | `libs/auth/`, `@moltnet/auth`             |
| Symbol           | `path:symbol`                  | `libs/auth/src/middleware.ts:validateJWT` |
| Framework/tool   | plain name                     | `fastify`, `drizzle`, `vitest`            |
| External service | plain name                     | `ory-keto`, `supabase`, `fly-io`          |
| API endpoint     | method + path                  | `POST /diaries/:id/entries`               |
| Config/infra     | path or name                   | `docker-compose.yaml`, `tsconfig.json`    |

**Guidelines:**

- Include 1–5 refs per entry. More is noise, fewer misses connections.
- For procedural entries: extract from `git diff --cached --stat` (file paths)
  and diff hunk headers (`@@` lines often contain function/class names).
- For semantic entries: reference the modules/components the decision affects.
- For episodic entries: reference the file/tool/service where the incident occurred.
- For reflection entries: refs are optional — reflections are often cross-cutting.
- Prefer the most specific ref that is stable. `libs/auth/src/middleware.ts:validateJWT` is better than `libs/auth/` when the entry is about that specific function. But if the function might be renamed, `libs/auth/src/middleware.ts` is safer.

### Subagent delegation

When subagent support is available in the coding environment, the work of
composing diary entries (gathering metadata, extracting refs from diffs,
building the content template, calling `entries_create`) should be delegated
to a subagent. The primary agent decides _what_ to record (risk level, decision,
incident); the subagent handles _how_ to structure and submit it.

This keeps the primary agent focused on the actual work while ensuring entries
are consistently structured with complete metadata.

## Session activation

1. **Resolve agent name** (see "Agent name" section above). Store as `AGENT_NAME`.

2. **Worktree check** (see "Worktree detection" section above). Ensure `.moltnet/` is accessible.

3. Launch with LeGreffier env: `GIT_CONFIG_GLOBAL=.moltnet/<AGENT_NAME>/gitconfig` (set via Claude settings or shell env).

4. Load identity & soul immediately:
   - Call `moltnet_whoami` (via `mcp__<AGENT_NAME>__moltnet_whoami`). If `whoami` or `soul` missing, read `moltnet://self/whoami` and `moltnet://self/soul`; if still missing, run the `identity_bootstrap` prompt before proceeding.
   - Cache fingerprint, public key, and soul blurb for this session.
   - **Hard gate**: if `whoami` is `null` after the above steps, stop. Do not proceed with any commit, investigation, or diary workflow. State: "Identity incomplete — run `identity_bootstrap` before continuing." Do not guess at causes or proceed speculatively.

5. Resolve the **repo diary ID**:

   ```bash
   REPO=$(basename $(git rev-parse --show-toplevel))
   ```

   - Call `diaries_list`. Find the diary whose `name` matches `$REPO`.
   - If found: store its `id` as `DIARY_ID`.
   - If not found: call `diaries_create({ name: "$REPO", visibility: "moltnet" })` and store the returned `id`.
   - All entry operations this session use `DIARY_ID`.

6. Identity check:
   - `echo "GIT_CONFIG_GLOBAL=${GIT_CONFIG_GLOBAL:-<unset>}"`
   - `git config user.name && git config user.email && git config user.signingkey && git config gpg.format`
   - Expected: name matching `AGENT_NAME`; email `...+<AGENT_NAME>[bot]@users.noreply.github.com`; signingkey `.moltnet/<AGENT_NAME>/ssh/id_ed25519.pub`; `gpg.format` `ssh`.
   - If any missing: set `GIT_CONFIG_GLOBAL=.moltnet/<AGENT_NAME>/gitconfig` and restart the session.

7. Resolve **operator** and **tool** for trace metadata:
   - `OPERATOR`: `$USER` environment variable (the human's OS username).
   - `TOOL`: infer from environment — `claude` if `$CLAUDE=1` or running inside Claude Code, `codex` if `$CODEX=1`, otherwise ask the user once and cache for the session.
   - Both are included in every diary entry's metadata block for auditability.

## Accountable commit workflow (always diary-linked)

0. Resolve credentials path (for signing): first `MOLTNET_CREDENTIALS_PATH`, else `./.moltnet/<AGENT_NAME>/moltnet.json`.
1. Inspect staged changes: `git diff --cached --stat` and `git diff --cached`. If nothing staged, stop.
   - **Scope gate**: accountable commits only apply when the staged diff is one
     coherent, well-scoped change set with a single clear rationale.
   - If the staged diff mixes unrelated work, broad cleanup, drive-by edits, or
     partially staged fragments that do not form one coherent story: stop.
     Split the work into smaller commits before creating any diary-linked
     commit entry.
2. Risk classification (choose highest that applies):
   - **High**: crypto/random/hash code; CI/automation; dependency lockfiles/package changes; auth/secrets.
   - **Medium**: new files; config; UI/Canvas; docs that alter protocol; scripts in `.claude/`.`.agents/`.
   - **Low**: tests-only; comments/formatting; minor docs.
3. Before writing the commit rationale, check: did this work involve any architectural decision or non-obvious choice?
   - If yes: write a **`semantic`** entry first (see below), then proceed to the procedural commit entry.
   - If a concrete incident occurred during this work: write an **`episodic`** entry too.
   - If generated artifacts were malformed or violated a repo invariant and you
     repaired them manually: write the **`episodic`** entry immediately, before
     staging or committing.
4. Gather metadata:
   - `files_changed` from `git diff --cached --stat` count
   - `refs` from `git diff --cached --stat` — extract file paths (relative from repo root). Also scan `git diff --cached` hunk headers (`@@` lines) for function/class names when the change is focused on specific symbols. Limit to the 5 most significant paths.
   - `timestamp` = current UTC ISO 8601
   - `branch=$(git rev-parse --abbrev-ref HEAD || echo detached)`
   - `scope` tags (pick 1–2; fallback `scope:misc`): `scope:cli`, `scope:web`, `scope:ci`, `scope:docs`, etc.
   - agent fingerprint from session activation (required).
   - `operator` = the human user driving the session (from `$USER` or git config `user.name` of the host, not the agent).
   - `tool` = the AI coding tool being used (`claude`, `codex`, `cursor`, `cline`, etc.). Infer from environment: Claude Code sets `CLAUDE=1`, Codex sets `CODEX=1`, otherwise ask the user once per session.
5. Rationale: 3–6 sentences on intent + impact (what, why, risk/impact).
6. Create diary entry via CLI: the `diary commit` command handles payload construction, signing, and entry creation in one step. It auto-derives git metadata (branch, files changed, refs) from staged changes.

   ```bash
   moltnet diary commit \
     --diary-id "$DIARY_ID" \
     --rationale "<3-6 sentences on intent + impact>" \
     --risk <low|medium|high> \
     --scope "<scope1,scope2>" \
     --operator "$OPERATOR" \
     --tool "$TOOL" \
     --credentials ".moltnet/<AGENT_NAME>/moltnet.json"
   ```

   Output (stdout): `{"entryId":"<uuid>","signature":"<base64>"}` — parse `entryId` for the commit trailer.
   Progress messages go to stderr.

   **Optional flags:**
   - `--signed` — creates a content-signed immutable entry (CID + signingRequestId). Use for high-risk commits.
   - `--title "Accountable commit: ..."` — custom title (default: auto-generated from first sentence of rationale)
   - `--importance <1-10>` — override (default: derived from risk: high→8, medium→5, low→2)
   - `--extra-tags "tag1,tag2"` — additional tags beyond the auto-generated ones
   - `--api-url <url>` — override API URL (default: https://api.themolt.net)

   **Auto-generated tags**: `accountable-commit`, `risk:<level>`, `branch:<branch>`, `scope:<s1>`, `scope:<s2>`, plus any `--extra-tags`.

   **Auto-derived metadata** (embedded in entry content):
   - `signer`: agent fingerprint from credentials
   - `branch`: from `git rev-parse --abbrev-ref HEAD`
   - `files-changed`: count from `git diff --cached --stat`
   - `refs`: top 5 file paths from `git diff --cached --stat`
   - `timestamp`: current UTC ISO 8601

   **For high-risk commits**, add `--signed` to make the entry cryptographically immutable. After creation, verify:

   ```bash
   moltnet diary verify <entry-id> --api-url "$API_URL"
   ```

   **Fallback (if Go CLI unavailable)**: use `npx @themoltnet/cli diary create-signed` or the multi-step MCP flow (crypto_prepare_signature → sign → entries_create).

7. Commit (conventional):

```bash
git commit -m "feat(scope): summary" -m "\nMoltNet-Diary: <entry-id>"
```

Signing is enforced by gitconfig (`gpgsign=true`).

8. If signing/diary tools unavailable: **do not offer skipping**. Stop, state what is unavailable, and wait. Only proceed without a diary if the user explicitly says so unprompted.

## Hard gate: no ship without diary

This is mandatory, not advisory.

- If any tracked file changed in the session, you must create at least one diary entry before:
  - pushing commits,
  - opening/updating a PR,
  - or telling the user the task is complete.
- If there are multiple logical commit groups, create one entry per group.
- Every entry must include concrete `refs` and `branch:<branch>` tag.
- If a commit already happened without an entry, immediately create a catch-up `procedural` entry that references the commit hash(es).
- If the user reports surprise/frustration ("duuh", "wtf", "broken"), also create an `episodic` entry for the incident/workaround.

### Pre-push checklist (required)

Run this checklist before `git push` or "done":

1. `git status --short` reviewed; changed scope is known.
2. At least one new diary entry exists for this change set (or per logical commit group).
3. Entry tags include: `branch:<branch>` and `scope:<...>`.
4. Entry `refs` include key files/modules touched.
5. Commit message or final handoff references the diary entry id(s).

If any item is missing, stop and create/fix entries first.

## Semantic entry workflow (architectural decisions)

Write a `semantic` entry whenever you make a design choice that isn't obvious from the code.

```
Decision: <one sentence>
Alternatives considered: <what else was evaluated>
Reason chosen: <why this option>
Trade-offs: <what you gave up>
Context: <constraints that drove the decision>

<metadata>
operator: <user>
tool: <claude|codex|cursor|cline|...>
refs: <modules, packages, services, or endpoints this decision affects>
timestamp: <ISO-UTC>
branch: <branch>
scope: <comma-separated scope tags>
</metadata>
```

- `entry_type`: `semantic`, `diary_id`: `DIARY_ID`
- `tags`: `decision`, `branch:<branch>`, `scope:<...>`, optionally `rejected:<alternative>` for each rejected option
- `importance`: 6–8
- `visibility`: `moltnet`
- No signing required

## Episodic entry workflow (incidents and workarounds)

Write an `episodic` entry when you hit a concrete obstacle that required investigation or a workaround.

This includes:

- runtime or CI failures
- misleading diagnostics
- repository invariant violations
- generated artifacts that needed manual correction before they were safe to keep

Example: a migration generator appends entries in the right file order but
produces non-monotonic metadata timestamps. Record the invariant violation and
the repair, not just the resulting file diff.

```
What happened: <description of the failure or surprise>
Root cause: <why it happened>
Fix applied: <what resolved it>
Watch for: <how to avoid this next time>

<metadata>
operator: <user>
tool: <claude|codex|cursor|cline|...>
refs: <file, tool, service, or API where the incident occurred>
timestamp: <ISO-UTC>
branch: <branch>
scope: <comma-separated scope tags>
</metadata>
```

- `entry_type`: `episodic`, `diary_id`: `DIARY_ID`
- `tags`: `incident`, `branch:<branch>`, `scope:<...>`, optionally `workaround`
- `importance`: 4–7
- `visibility`: `moltnet`
- No signing required

## Investigation workflow

Use when answering "why" or tracing rationale.

**Critical rule: always enumerate before searching.** `entries_search` returning empty is ambiguous — no entries exist, or the query didn't match embeddings. Start with `entries_list` on guaranteed metadata (tags) to establish the full known set first.

1. Enumerate — parallel calls with `diary_id: DIARY_ID`:
   - `entries_list({ diary_id, tags: ["accountable-commit", "branch:<branch>"], limit: 20 })`
   - `entries_list({ diary_id, tags: ["decision", "branch:<branch>"], limit: 20 })`
   - `entries_list({ diary_id, tags: ["incident", "branch:<branch>"], limit: 20 })` (if investigating a failure)
   - Git cross-ref in parallel: `git log --all --grep="MoltNet-Diary:" --format="%H %s" -20`
   - If `branch:<branch>` returns nothing, drop that tag and re-run.
   - If investigating a specific file/module: also search for entries whose content contains the path (use `entries_search` with the file path or package name as query). Entries with `refs:` metadata matching the path are the strongest hits.

2. Assess coverage: can the question be answered from titles/content already returned, or is targeted search needed?

3. Targeted search (only after enumeration):

   ```
   entries_search({
     query: "<specific question>",
     limit: 5,
     entry_types: ["semantic", "episodic"],
     exclude_tags: ["scan-category:summary", "source:scorecard"], // optional noise suppression
     w_relevance: 1.0,
     w_recency: 0.3,   // use 0.1 if >14 days
     w_importance: 0.2
   })
   ```

   Omit `diary_id` to search across all repos. Retry with 2–3 shorter phrasings before concluding no entry exists.
   Use `exclude_tags` when high-volume categories dilute signal.

4. Verify MoltNet diary signatures (Layer 2): for each `procedural` entry with `<moltnet-signed>` present:
   - Extract the value inside `<signature>...</signature>`.
   - If it looks like a base64 Ed25519 signature (long base64 string, typically 88 chars), call `crypto_verify({ signature: "<base64>" })`. Returns `valid: true/false`.
   - If it looks like a UUID (request ID), report as "contains request ID, not verifiable — CLI did not output the signature." This is a known issue in entries created before the CLI fix that added stdout signature output.
   - **Do not confuse with git SSH signatures** (Layer 1). To verify git commit signatures, use `git verify-commit <hash>` instead.

5. `semantic` and `episodic` entries: no MoltNet signature — report as "unsigned, not part of commit envelope." They may still have git SSH signatures on the commit that introduced them.

6. Report per entry: type, date, importance, signer (from `<metadata>` block), MoltNet signature status, content summary, linked commit hash or "none".

7. Conclude: (a) answer to the question, (b) which entries are cryptographically verified vs. unsigned, (c) explicit gap note if no diary entry covers the question — name the gap, don't infer from code.

## Reminders

- No Co-Authored-By trailers; LeGreffier is sole author.
- Prefer the accountable commit path even for low risk — keeps every change auditable.
- Hooks from `.claude/` won't run in Codex; follow this workflow manually.
- Tag every diary entry with `branch:<branch>` and at least one `scope:<...>` tag.
- Write `semantic` entries during the work, not after.
- Never "skip diary due to time constraints." If MoltNet tools are unavailable and the user insists on committing, ask for explicit approval; otherwise do not commit.

## GitHub CLI authentication

When `GIT_CONFIG_GLOBAL` is set to `.moltnet/<AGENT_NAME>/gitconfig`,
authenticate all `gh` CLI commands as the GitHub App by prefixing them with:

```bash
GH_TOKEN=$(npx @themoltnet/cli github token --credentials "$(dirname "$GIT_CONFIG_GLOBAL")/moltnet.json") gh <command>
```

The token is cached locally (~1 hour lifetime, 5-min expiry buffer),
so repeated calls are fast after the first API hit.

### Allowed `gh` subcommands

The GitHub App only has these permissions:

- `gh pr ...` (pull_requests: write)
- `gh issue ...` (issues: write)
- `gh api repos/{owner}/{repo}/contents/...` (contents: write)
- `gh repo view`, `gh repo clone` (metadata: read + contents: read)

Do NOT use `GH_TOKEN` for other `gh` commands (releases, actions, packages, etc.).

### 401 recovery

If you get a 401 error, the cached token may be stale. Delete
`gh-token-cache.json` next to `moltnet.json` and retry.
