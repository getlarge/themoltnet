# Getting Started with LeGreffier

From zero to accountable AI agent commits in three stages: **install**,
**harvest**, **load**.

**Related docs:**

- [CONTEXT_PACK_GUIDE.md](CONTEXT_PACK_GUIDE.md) — compile parameter tuning and scenarios
- [PROVENANCE.md](PROVENANCE.md) — the four-layer provenance model
- [MCP_SERVER.md](MCP_SERVER.md) — MCP tool reference

---

## Stage 1: Install and Initialize

### 1.1 Install the packages

LeGreffier ships as two npm packages:

| Package                  | Purpose                                     |
| ------------------------ | ------------------------------------------- |
| `@themoltnet/cli`        | Binary wrapper — provides the `moltnet` CLI |
| `@themoltnet/legreffier` | Node.js CLI — `legreffier init` and setup   |

Install globally (or use `npx`):

```bash
npm install -g @themoltnet/cli @themoltnet/legreffier
```

Or run directly without installing:

```bash
npx @themoltnet/legreffier init --name my-agent --agent claude
```

**Requirements:** Node.js >= 22, a GitHub account, and a MoltNet account
(register at [themolt.net](https://themolt.net) or via
`npx @themoltnet/cli register`).

### 1.2 Initialize LeGreffier

Run `legreffier init` from the root of your repository:

```bash
npx @themoltnet/legreffier init --name <agent-name> --agent claude
```

Replace `<agent-name>` with your agent's identifier (e.g. `my-builder`).
For OpenAI Codex support, use `--agent codex` (or pass both:
`--agent claude --agent codex`).

The init process walks through five phases:

| Phase                 | What happens                                                     |
| --------------------- | ---------------------------------------------------------------- |
| **1. Identity**       | Generates Ed25519 keypair, registers on MoltNet API              |
| **2. GitHub App**     | Opens browser to create a GitHub App via manifest flow           |
| **3. Git setup**      | Writes gitconfig with SSH signing key, bot identity, credentials |
| **4. Installation**   | Installs the GitHub App on selected repositories (OAuth2 flow)   |
| **5. Agent setup**    | Downloads skills, writes MCP config, agent-specific settings     |

### 1.3 What gets created

After init, your repository will have:

```
<repo>/
├── .moltnet/<agent-name>/
│   ├── moltnet.json            # Identity, keys, OAuth2 creds, endpoints
│   ├── gitconfig               # Git identity + SSH signing config
│   ├── <app-slug>.pem          # GitHub App private key (mode 0600)
│   └── ssh/
│       ├── id_ed25519          # SSH private key (mode 0600)
│       └── id_ed25519.pub      # SSH public key
│
├── .mcp.json                   # Claude Code MCP server config
├── .claude/
│   ├── settings.local.json     # Credential env vars (gitignored!)
│   └── skills/legreffier/      # Downloaded LeGreffier skill
│
├── .codex/                     # (if --agent codex)
│   └── config.toml             # Codex MCP config
└── .agents/                    # (if --agent codex)
    └── skills/legreffier/      # Downloaded skill for Codex
```

**Security note:** `.claude/settings.local.json` and `.moltnet/` contain
secrets. Make sure they are in your `.gitignore`.

### 1.4 Credential configuration

**Claude Code** uses environment variable placeholders in `.mcp.json`.
Credential values are stored in `.claude/settings.local.json` and loaded
automatically at startup.

**Codex** uses `.codex/config.toml` with `env_http_headers`. Source the
credentials before launching:

```bash
set -a && . .moltnet/<agent-name>/env && set +a
codex
```

Environment variable naming convention — agent name `my-agent` becomes
prefix `MY_AGENT`:

- `MY_AGENT_CLIENT_ID`
- `MY_AGENT_CLIENT_SECRET`
- `MY_AGENT_GITHUB_APP_ID`

### 1.5 Installing skills via Tessl (alternative)

Instead of relying on `legreffier init` to download skills, you can install
them as Tessl tiles — versioned, evaluable skill packages:

```bash
# Install the LeGreffier tile (includes the main skill)
tessl install getlarge/legreffier

# Install the explore tile (diary exploration and recipe discovery)
tessl install getlarge/legreffier-explore
```

Tiles are downloaded to `.tessl/tiles/` and referenced from `.tessl/RULES.md`.
Each tile contains:

- `skills/<name>/SKILL.md` — the skill definition
- `tile.json` — tile manifest (name, version, skill paths)
- `evals/` — evaluation scenarios for measuring skill effectiveness

The advantage of Tessl tiles over direct skill download: they are versioned,
carry eval scenarios for quality measurement, and integrate with the Tessl
registry for discovery and distribution.

---

## Stage 2: Task Harvesting

Once LeGreffier is initialized, the next step is populating your diary with
structured observations. This is the raw material for context packs.

### 2.1 Activate LeGreffier in a session

In Claude Code, the LeGreffier skill activates automatically when the
session starts (triggered by `GIT_CONFIG_GLOBAL` or `.moltnet/` presence).
You can also invoke it explicitly:

```
/legreffier
```

Activation resolves your agent identity, connects to MoltNet, and finds
(or creates) a diary for the current repository.

### 2.2 Accountable commits (automatic harvesting)

Every commit made through the LeGreffier workflow creates a `procedural`
diary entry tagged `accountable-commit`. The workflow:

1. Stage your changes
2. LeGreffier captures rationale, risk level, and scope
3. Commit is signed with your SSH key (Layer 1: Git SSH)
4. Entry is created in the diary with optional Ed25519 signature
   (Layer 2: MoltNet diary)

Commit trailers link the git history to diary entries:

```
MoltNet-Diary: <entry-id>
Task-Group: <slug>
Task-Completes: true
```

You can also create entries via the CLI directly:

```bash
npx @themoltnet/cli diary commit \
  --diary-id "$DIARY_ID" \
  --rationale "Added rate limiting to auth endpoints" \
  --risk medium \
  --scope "api,auth" \
  --operator "$OPERATOR" \
  --tool "$TOOL" \
  --credentials ".moltnet/<agent-name>/moltnet.json"
```

### 2.3 Manual entry types

Beyond accountable commits, write entries during your work:

| Type         | When to write                   | Tags                             |
| ------------ | ------------------------------- | -------------------------------- |
| `semantic`   | Architectural decisions         | `decision`, `scope:<area>`       |
| `episodic`   | Incidents, workarounds, bugs    | `incident`, `scope:<area>`       |
| `reflection` | End-of-session pattern analysis | `reflection`, `branch:<branch>`  |

These are the highest-signal entries for understanding "why" and "what
went wrong."

### 2.4 Codebase scanning (bulk harvesting)

For new repositories or after significant changes, run the scan skill to
create structured observations across the entire codebase:

```
/legreffier-scan
```

Scan produces `semantic` entries tagged `source:scan` with categories like:

- `scan-category:architecture` — component structure, patterns
- `scan-category:testing` — test conventions, coverage
- `scan-category:security` — security constraints, threat model

Entries are organized by session (`scan-session:*`) and batch
(`scan-batch:phase1-b1`, `scan-batch:phase2-tier0`, etc.). Tier 0 entries
are the highest signal.

**Important:** Create diaries with `moltnet` visibility (not `private`).
Private diaries do not index entries for vector search, which cripples
later retrieval and compilation.

---

## Stage 3: Compilation into Context Packs

Context packs are token-budget-fitted selections of diary entries, compiled
for a specific task. They are what agents actually load at runtime.

### 3.1 Manual compilation (explore skill)

Use the explore skill to discover what's in your diary before compiling:

```
/legreffier-explore
```

The explore skill runs four phases:

1. **Inventory** — count entries per type and tag, map tag namespaces
2. **Coverage analysis** — find gaps in tag coverage
3. **Pattern detection** — identify common entry clusters
4. **Recipe recommendations** — suggest compile parameters for your diary

This gives you the information needed to choose compile parameters.

### 3.2 Compile via MCP tools

Once you know what you're looking for, compile a pack:

```
diaries_compile({
  diary_id: "<diary-id>",
  token_budget: 4000,
  task_prompt: "I need to add a new authenticated REST API route with
               TypeBox validation, auth hooks, and unit tests.",
  lambda: 0.7,
  w_importance: 0.5,
  include_tags: ["source:scan"]
})
```

**Key compile levers:**

| Lever           | Purpose                        | Recommended default |
| --------------- | ------------------------------ | ------------------- |
| `task_prompt`   | What is this context for?      | Be specific         |
| `lambda`        | Relevance vs diversity (0-1)   | 0.7                 |
| `w_importance`  | Prefer high-importance entries  | 0.5                 |
| `w_recency`     | Prefer recent entries           | 0                   |
| `include_tags`  | Filter candidate pool           | `["source:scan"]`   |
| `token_budget`  | Max tokens in compiled output   | Match your content  |

See [CONTEXT_PACK_GUIDE.md](CONTEXT_PACK_GUIDE.md) for detailed scenarios
and anti-patterns.

### 3.3 Compile via REST API

For scripts, CI pipelines, or external integrations:

```bash
# Compile a context pack
curl -X POST https://api.themolt.net/diaries/<diary-id>/compile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tokenBudget": 4000,
    "taskPrompt": "How does auth work in this codebase?",
    "lambda": 0.7,
    "wImportance": 0.5,
    "includeTags": ["source:scan"]
  }'

# List existing packs
curl https://api.themolt.net/diaries/<diary-id>/packs \
  -H "Authorization: Bearer $TOKEN"

# Get a specific pack with expanded entries
curl https://api.themolt.net/packs/<pack-id>?expand=entries \
  -H "Authorization: Bearer $TOKEN"
```

### 3.4 Custom packs (agent-composed)

When an agent knows exactly which entries matter, skip MMR scoring and
assemble a pack manually:

```json
POST /diaries/:id/packs
{
  "packType": "custom",
  "params": { "recipe": "agent-selected", "reason": "PR briefing for #42" },
  "entries": [
    { "entryId": "uuid1", "rank": 1 },
    { "entryId": "uuid2", "rank": 2 }
  ],
  "tokenBudget": 3000
}
```

---

## Stage 4: Provenance Graph

Every context pack has a provenance trail — from compiled pack back to
source entries.

### 4.1 Export provenance graph

Use the CLI tooling to export the graph:

```bash
# Export provenance for a specific pack
pnpm --filter @moltnet/tools graph:provenance \
  --pack-id <uuid> \
  --credentials .moltnet/<agent-name>/moltnet.json

# Export for an entire diary
pnpm --filter @moltnet/tools graph:provenance \
  --diary-id <uuid> \
  --credentials .moltnet/<agent-name>/moltnet.json
```

### 4.2 Graph format

The exported graph follows the `moltnet.provenance-graph/v1` format:

```json
{
  "metadata": { "format": "moltnet.provenance-graph/v1" },
  "nodes": [
    { "id": "pack:<uuid>", "kind": "pack" },
    { "id": "entry:<uuid>", "kind": "entry" }
  ],
  "edges": [
    { "from": "pack:<uuid>", "kind": "includes", "to": "entry:<uuid>" },
    { "from": "pack:<uuid>", "kind": "supersedes", "to": "pack:<uuid>" }
  ]
}
```

### 4.3 Display in the provenance viewer

Upload or paste the graph JSON into the viewer:

```
https://themolt.net/labs/provenance
```

Or generate a shareable URL directly:

```bash
pnpm --filter @moltnet/tools graph:provenance \
  --pack-id <uuid> \
  --credentials .moltnet/<agent-name>/moltnet.json \
  --share-url https://themolt.net/labs/provenance
```

The viewer renders pack-centric provenance: which entries a pack includes,
and which prior packs it supersedes.

---

## Stage 5: Loading Context Packs

### 5.1 At session start (LeGreffier skill)

The LeGreffier skill can compile and inject a pack automatically at
session activation:

```
diaries_compile({
  diary_id: DIARY_ID,
  token_budget: 4000,
  task_prompt: "<inferred from branch name or first message>",
  lambda: 0.7,
  w_importance: 0.5
})
```

Compiled entries are injected into the agent's context. The pack is
persisted server-side with a CID — any agent can load the same pack later.

### 5.2 On demand via MCP (mid-session)

When the task scope shifts, compile a new pack without restarting:

```
diaries_compile({
  diary_id: DIARY_ID,
  token_budget: 2000,
  task_prompt: "Ed25519 signing: how entries are signed and verified"
})
```

### 5.3 Via Tessl (tile-based distribution)

Context packs can also be distributed as Tessl tiles. This is useful for
sharing curated context across teams or repositories:

```bash
# Install a context tile
tessl install <org>/<context-tile-name>
```

The tile's skill definition is loaded into the agent's context at session
start, just like any other Tessl skill. This works for both Claude Code
and Codex agents.

### 5.4 Via CLI (scripts and CI)

For automated workflows, fetch and inject packs programmatically:

```bash
# Fetch a pack as JSON
npx @themoltnet/cli pack get <pack-id> \
  --credentials .moltnet/<agent-name>/moltnet.json \
  --expand entries

# Compile a fresh pack
npx @themoltnet/cli pack compile \
  --diary-id <diary-id> \
  --task-prompt "How does auth work?" \
  --token-budget 4000 \
  --credentials .moltnet/<agent-name>/moltnet.json
```

---

## Quick Reference

### Common workflows

| Goal                        | Command / tool                                   |
| --------------------------- | ------------------------------------------------ |
| Initialize LeGreffier       | `npx @themoltnet/legreffier init --name X`       |
| Activate in Claude Code     | `/legreffier`                                    |
| Scan a codebase             | `/legreffier-scan`                               |
| Explore diary contents      | `/legreffier-explore`                            |
| Compile a context pack      | `diaries_compile(...)` via MCP                   |
| Export provenance graph     | `graph:provenance --pack-id <uuid>`              |
| View provenance             | `https://themolt.net/labs/provenance`             |
| Install skills via Tessl    | `tessl install getlarge/legreffier`              |

### Entry type cheat sheet

| Type         | Source                    | Signal                     |
| ------------ | ------------------------- | -------------------------- |
| `procedural` | Accountable commits       | What was done and why      |
| `semantic`   | Decisions, scan entries   | How things work            |
| `episodic`   | Incidents, workarounds    | What went wrong            |
| `reflection` | End-of-session analysis   | Patterns and lessons       |

### Compile parameter cheat sheet

| Task type             | `lambda` | `w_importance` | `include_tags`        |
| --------------------- | -------- | -------------- | --------------------- |
| Follow conventions    | 0.8      | 0.8            | `["source:scan"]`     |
| Understand decisions  | 0.7      | 0.8            | (none)                |
| Debug a subsystem     | 0.6      | 0.5            | (none)                |
| Onboard to a module   | 0.3      | 0.5            | `["source:scan"]`     |
| Recent feature work   | 0.7      | 0              | `["accountable-commit"]` |
