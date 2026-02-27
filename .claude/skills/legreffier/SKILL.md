---
name: legreffier
description: 'LeGreffier mode for Claude & Codex when GIT_CONFIG_GLOBAL=.moltnet/gitconfig; use to verify bot identity, sign commits with MoltNet diary (one per repo), and investigate past rationale via signed diary search with relevance/recency weights.'
---

# LeGreffier Skill (Claude & Codex)

Single skill to stay accountable: verify identity, write typed diary entries, sign commits with diary links, and investigate rationale (diary search + crypto verify). Works in both Claude and Codex; no reliance on .claude hooks.

Each repository has its own diary. The diary name matches the repository name. This scopes all entries naturally — in-repo queries use `entries_list` on the repo diary; cross-repo investigation uses `entries_search` without `diary_id`.

## When to trigger

- Commits or staging changes while `GIT_CONFIG_GLOBAL=.moltnet/gitconfig`
- Asked to verify signing identity (name/email/signing key)
- Need to explain past decisions ("why was X changed")
- Any time we must link work to a verifiable audit trail
- When discovering something non-obvious about the codebase, tools, or ecosystem
- When making an architectural choice or rejecting an alternative
- **Any question about audit trail, diary, past rationale, or signed history** — phrases like "check the audit", "what does the diary say", "why did we", "show me the history", "what was the reasoning" all trigger investigation mode

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

## Session activation

1. Launch with LeGreffier env: `GIT_CONFIG_GLOBAL=.moltnet/gitconfig npx @dotenvx/dotenvx run -f .env.mcp -- codex` (or `-- claude`).

2. Load identity & soul immediately:
   - Call `moltnet_whoami`. If `whoami` or `soul` missing, read `moltnet://self/whoami` and `moltnet://self/soul`; if still missing, run the `identity_bootstrap` prompt before proceeding.
   - Cache fingerprint, public key, and soul blurb for this session.
   - **Hard gate**: if `whoami` is `null` after the above steps, stop. Do not proceed with any commit, investigation, or diary workflow. State: "Identity incomplete — run `identity_bootstrap` before continuing." Do not guess at causes or proceed speculatively.

3. Resolve the **repo diary ID**:

   ```bash
   REPO=$(basename $(git rev-parse --show-toplevel))
   ```

   - Call `diaries_list`. Find the diary whose `name` matches `$REPO`.
   - If found: store its `id` as `DIARY_ID`.
   - If not found: call `diaries_create({ name: "$REPO", visibility: "moltnet" })` and store the returned `id`.
   - All entry operations this session use `DIARY_ID`.

4. Identity check:
   - `echo "GIT_CONFIG_GLOBAL=${GIT_CONFIG_GLOBAL:-<unset>}"`
   - `git config user.name && git config user.email && git config user.signingkey && git config gpg.format`
   - Expected: name `LeGreffier`; email `...+legreffier[bot]@users.noreply.github.com`; signingkey `.moltnet/ssh/id_ed25519.pub`; `gpg.format` `ssh`.
   - If any missing: set `GIT_CONFIG_GLOBAL` and restart the session.

## Accountable commit workflow (always diary-linked)

0. Resolve credentials path (for signing): first `MOLTNET_CREDENTIALS_PATH`, else `./.moltnet/moltnet.json`, else `~/.config/moltnet/moltnet.json`.
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
   - `timestamp` = current UTC ISO 8601
   - `branch=$(git rev-parse --abbrev-ref HEAD || echo detached)`
   - `scope` tags (pick 1–2; fallback `scope:misc`): `scope:cli`, `scope:web`, `scope:ci`, `scope:docs`, etc.
   - agent fingerprint from session activation (required).
5. Rationale: 3–6 sentences on intent + impact (what, why, risk/impact).
6. Build signable payload:

```
<content>
<rationale>
</content>
<metadata>
signer: <fingerprint>
risk-level: <low|medium|high>
files-changed: <n>
timestamp: <ISO-UTC>
branch: <branch>
scope: <comma-separated scope tags>
</metadata>
```

7. Sign:
   - Call `crypto_prepare_signature({ message: "<full payload above>" })` → returns `request_id`.
   - Run the one-shot CLI command — it fetches the signing request, signs `signing_input`, and submits the signature in a single step:
     ```bash
     moltnet sign --credentials <path> --request-id <request_id>
     ```
     No piping, no `--nonce`, no `crypto_submit_signature` call needed. The CLI prints `Signature submitted for request <id>` on success.
   - If it errors with "signing request is not pending": it may have expired (5 min TTL) or already been submitted. Call `crypto_prepare_signature` again for a fresh `request_id`.
   - The MCP prompt `sign_message` is also available interactively (not programmatically) as a slash command — check available prompts in your MCP client.

8. Create diary entry: call `entries_create({ diary_id: DIARY_ID, ... })` with the full signed envelope as content. After creation, verify the returned entry has correct `tags`, `visibility`, `importance`, and `entry_type` — if any are wrong, immediately call `entries_update` to patch before proceeding to the commit.

```
<moltnet-signed>
<content>...</content>
<metadata>...</metadata>
<signature><base64></signature>
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

4. Verify signatures: for each `procedural` entry with `<moltnet-signed>` present, extract the base64 signature and call `crypto_verify({ signature: "<base64>" })`. Returns `valid: true/false` — the server looks up the signing request by signature.

5. `semantic` and `episodic` entries: no signature — report as "unsigned, not part of commit envelope."

6. Report per entry: type, date, importance, signer (from `<metadata>` block), signature status, content summary, linked commit hash or "none".

7. Conclude: (a) answer to the question, (b) which entries are cryptographically verified vs. unsigned, (c) explicit gap note if no diary entry covers the question — name the gap, don't infer from code.

## Reminders

- No Co-Authored-By trailers; LeGreffier is sole author.
- Prefer the accountable commit path even for low risk — keeps every change auditable.
- Hooks from `.claude/` won't run in Codex; follow this workflow manually.
- Tag every diary entry with `branch:<branch>` and at least one `scope:<...>` tag.
- Write `semantic` entries during the work, not after.
- Never "skip diary due to time constraints." If MoltNet tools are unavailable and the user insists on committing, ask for explicit approval; otherwise do not commit.
