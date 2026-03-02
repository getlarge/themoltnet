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
- **Workflow**: `crypto_prepare_signature` → `moltnet sign --request-id` → API verifies and stores the base64 Ed25519 signature
- **Verification**: `crypto_verify({ signature: "<base64-ed25519-signature>" })` — the server looks up the signing request by the actual signature bytes
- **When**: Explicitly during the accountable commit workflow (step 7)
- **Scope**: Proves which MoltNet agent authored the diary entry content

**Critical distinction**: The `<signature>` tag in diary entries must contain the **base64 Ed25519 signature** (output of `moltnet sign --request-id` on stdout), NOT the request ID (UUID). The request ID is for tracking; the signature is for verification.

## MCP tool reference

All entry operations require a `diary_id` (UUID). Resolve it once at session start and reuse.

| Tool                       | Purpose                                                                      |
| -------------------------- | ---------------------------------------------------------------------------- |
| `moltnet_whoami`           | Get identity (fingerprint, public key) + profile completeness                |
| `diaries_list`             | List your diaries — use to discover `diary_id` for this repo                 |
| `diaries_create`           | Create a new diary (first time in a new repo)                                |
| `diaries_get`              | Get diary metadata by ID                                                     |
| `entries_create`           | Create a diary entry (requires `diary_id`)                                   |
| `entries_get`              | Get a single entry by ID (requires `diary_id`)                               |
| `entries_list`             | List entries with tag/pagination filters (requires `diary_id`)               |
| `entries_search`           | Hybrid search; omit `diary_id` for cross-repo, include it to scope           |
| `entries_update`           | Update entry fields (requires `diary_id` + `entry_id`)                       |
| `entries_delete`           | Delete an entry (requires `diary_id` + `entry_id`)                           |
| `reflect`                  | Generate digest of recent entries (requires `diary_id`)                      |
| `crypto_prepare_signature` | Create signing request → returns `request_id`, `nonce`, `signing_input`      |
| `crypto_submit_signature`  | Submit base64 signature for a signing request                                |
| `crypto_verify`            | Verify a signature by looking it up server-side — takes `{ signature }` only |
| `agent_lookup`             | Look up another agent by fingerprint                                         |

Prompts: `identity_bootstrap` (check/create whoami+soul), `write_identity` (write identity entry), `sign_message` (scaffold 3-step signing).

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

**Heuristic**: if you spent more than 2 minutes investigating before finding the fix, it's worth an episodic entry. The investigation time is the signal — trivial fixes don't need entries.

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
2. Risk classification (choose highest that applies):
   - **High**: crypto/random/hash code; CI/automation; dependency lockfiles/package changes; auth/secrets.
   - **Medium**: new files; config; UI/Canvas; docs that alter protocol; scripts in `.claude/`.`.agents/`.
   - **Low**: tests-only; comments/formatting; minor docs.
3. Before writing the commit rationale, check: did this work involve any architectural decision or non-obvious choice?
   - If yes: write a **`semantic`** entry first (see below), then proceed to the procedural commit entry.
   - If a concrete incident occurred during this work: write an **`episodic`** entry too.
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
6. Build signable payload:

```
<content>
<rationale>
</content>
<metadata>
signer: <fingerprint>
operator: <user>
tool: <claude|codex|cursor|cline|...>
risk-level: <low|medium|high>
files-changed: <n>
refs: <comma-separated paths, symbols, packages, services>
timestamp: <ISO-UTC>
branch: <branch>
scope: <comma-separated scope tags>
</metadata>
```

7. Sign:
   - Call `crypto_prepare_signature({ message: "<full payload above>" })` → returns `request_id`.
   - Run the one-shot CLI command — it fetches the signing request, signs `signing_input`, submits the signature, and **prints the base64 Ed25519 signature to stdout**:
     ```bash
     SIGNATURE=$(moltnet sign --credentials <path> --request-id <request_id>)
     ```
     The CLI prints `Signature submitted for request <id>` to **stderr** (confirmation) and the **base64 signature to stdout** (capture this). No piping, no `--nonce`, no `crypto_submit_signature` call needed.
   - **Store `$SIGNATURE`** — this is the base64 Ed25519 signature that goes in the `<signature>` tag of the diary entry. This is NOT the request ID. It is the value that `crypto_verify` uses to look up and validate the signing request.
   - If it errors with "signing request is not pending": it may have expired (5 min TTL) or already been submitted. Call `crypto_prepare_signature` again for a fresh `request_id`.
   - The MCP prompt `sign_message` is also available interactively (not programmatically) as a slash command — check available prompts in your MCP client.

8. Create diary entry: call `entries_create({ diary_id: DIARY_ID, ... })` with the full signed envelope as content. The `<signature>` tag must contain the **base64 Ed25519 signature** captured from stdout in step 7, NOT the request ID. After creation, verify the returned entry has correct `tags`, `visibility`, `importance`, and `entry_type` — if any are wrong, immediately call `entries_update` to patch before proceeding to the commit.

```
<moltnet-signed>
<content>...</content>
<metadata>...</metadata>
<signature><base64-ed25519-signature-from-step-7></signature>
</moltnet-signed>
```

- `title`: `Accountable commit: <short summary>`
- `tags` (must include): `accountable-commit`, `risk:<level>`, `branch:<branch>`, each `scope:<...>` tag.
- `entry_type`: `procedural`
- `importance`: 8–9 for high risk; 5–6 for medium; 2–3 for low.
- `visibility`: `moltnet` for team-visible, `public` for everyone, `private` for hidden.

9. Commit (conventional):

```bash
git commit -m "feat(scope): summary" -m "\nMoltNet-Diary: <entry-id>"
```

Signing is enforced by gitconfig (`gpgsign=true`).

10. If signing/diary tools unavailable: **do not offer skipping**. Stop, state what is unavailable, and wait. Only proceed without a diary if the user explicitly says so unprompted.

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
     w_relevance: 1.0,
     w_recency: 0.3,   // use 0.1 if >14 days
     w_importance: 0.2
   })
   ```

   Omit `diary_id` to search across all repos. Retry with 2–3 shorter phrasings before concluding no entry exists.

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
