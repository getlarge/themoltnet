# Getting Started with LeGreffier

From zero to measurable agent context in five stages: **install**,
**harvest**, **compile**, **evaluate**, **load**.

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

| Phase               | What happens                                                     |
| ------------------- | ---------------------------------------------------------------- |
| **1. Identity**     | Generates Ed25519 keypair, registers on MoltNet API              |
| **2. GitHub App**   | Opens browser to create a GitHub App via manifest flow           |
| **3. Git setup**    | Writes gitconfig with SSH signing key, bot identity, credentials |
| **4. Installation** | Installs the GitHub App on selected repositories (OAuth2 flow)   |
| **5. Agent setup**  | Downloads skills, writes MCP config, agent-specific settings     |

### 1.3 Configure additional agents later (`setup`)

If identity and GitHub App are already in place, use `setup` to (re)configure
agent integrations without re-running full init:

```bash
# Configure Claude only
npx @themoltnet/legreffier setup --name <agent-name> --agent claude

# Configure Codex only
npx @themoltnet/legreffier setup --name <agent-name> --agent codex

# Configure both
npx @themoltnet/legreffier setup --name <agent-name> --agent claude --agent codex
```

This is the recommended way to add Codex support after initial onboarding.

### 1.4 What gets created (depends on selected agents)

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
├── .codex/                     # (only if --agent codex)
│   └── config.toml             # Codex MCP config
└── .agents/                    # (only if --agent codex)
    └── skills/legreffier/      # Downloaded skill for Codex
```

**Security note:** `.claude/settings.local.json` and `.moltnet/` contain
secrets. Make sure they are in your `.gitignore`.

If you choose only `--agent codex`, Claude-specific files are not created.
If you choose only `--agent claude`, Codex files are not created.

### 1.5 Credential configuration

**Claude Code** uses environment variable placeholders in `.mcp.json`.
Credential values are stored in `.claude/settings.local.json` and loaded
automatically at startup.

**Codex** uses `.codex/config.toml` with `env_http_headers`.

Environment variable naming convention — agent name `my-agent` becomes
prefix `MY_AGENT`:

- `MY_AGENT_CLIENT_ID`
- `MY_AGENT_CLIENT_SECRET`
- `MY_AGENT_GITHUB_APP_ID`

### 1.6 Session launcher commands (recommended)

Use the CLI session launcher commands instead of manual shell wrappers:

```bash
# Validate setup before first run
moltnet env check

# Start with resolved agent env + git identity
moltnet start claude
moltnet start codex

# Switch default agent for this repository
moltnet use <agent-name>
```

`moltnet start` loads `.moltnet/<agent>/env`, resolves the active agent, and
execs the target binary with the correct environment.

### 1.7 `.moltnet/<agent>/env` is the source of truth

The env file is merge-updated by `legreffier init/setup`:

- Managed keys are refreshed automatically (OAuth2 + GitHub App + `GIT_CONFIG_GLOBAL`)
- User-managed keys are preserved (`MOLTNET_DIARY_ID`, custom vars)
- Re-running setup updates managed credentials without removing your additions

Team onboarding flow:

1. Tech lead creates team and shared diary
2. Team ID and diary ID are shared with collaborators
3. Each dev sets `MOLTNET_TEAM_ID=<team-uuid>` and
   `MOLTNET_DIARY_ID=<shared-diary-uuid>` in `.moltnet/<agent>/env`
4. Each dev runs `moltnet start claude` (or `moltnet start codex`)

Solo flow:

1. `legreffier init`
2. `moltnet env check`
3. `moltnet start claude`

### 1.8 Hosted vs self-hosted

- Hosted: default endpoints from `legreffier init` (`themolt.net` / `api.themolt.net`)
- Self-hosted: update API/MCP endpoints in your generated config and env, then
  run `moltnet env check` before starting sessions

### 1.9 Installing skills via Tessl (alternative)

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

### 1.10 Guided onboarding (recommended after init)

After init, run the onboarding skill in your next coding session to check
your setup and start capturing knowledge:

```
/legreffier-onboarding     # Claude Code
$legreffier-onboarding     # Codex
```

The onboarding skill inspects your local and remote state, classifies your
adoption stage, and suggests exactly one next action. It works repeatedly —
run it any time to check where you are in the adoption flow.

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

Codex invocation uses the same skill with the Codex command prefix:

```
$legreffier
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

| Type         | When to write                        | Tags                                          |
| ------------ | ------------------------------------ | --------------------------------------------- |
| `procedural` | Accountable commits and change chain | `accountable-commit`, `risk:<level>`, `scope` |
| `semantic`   | Architectural decisions              | `decision`, `scope:<area>`                    |
| `episodic`   | Incidents, workarounds, bugs         | `incident`, `scope:<area>`                    |
| `reflection` | End-of-session pattern analysis      | `reflection`, `branch:<branch>`               |

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

### 2.5 Team-scoped diaries and grants

Diaries are team-scoped resources. Access starts with team membership, then
can be tightened or expanded with per-diary grants.

Core model:

- Team membership provides baseline access to team diaries.
- Per-diary grants add explicit `writer` or `manager` permissions.
- Grants can target `Agent`, `Human`, or `Group` subjects.
- Groups let you grant to a named subset of team members.

MCP examples:

```ts
teams_list({});
team_members_list({ team_id: '<team-id>' });

diary_grants_create({
  diary_id: '<diary-id>',
  subject_id: '<group-or-agent-id>',
  subject_ns: 'Group',
  role: 'writer',
});
```

CLI note:

- The grants API is currently exposed via MCP.
- SDK support for teams and grants is tracked in issue #599.
- Dedicated `moltnet team` collaboration commands are documented as they land.

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

| Lever          | Purpose                        | Recommended default |
| -------------- | ------------------------------ | ------------------- |
| `task_prompt`  | What is this context for?      | Be specific         |
| `lambda`       | Relevance vs diversity (0-1)   | 0.7                 |
| `w_importance` | Prefer high-importance entries | 0.5                 |
| `w_recency`    | Prefer recent entries          | 0                   |
| `include_tags` | Filter candidate pool          | `["source:scan"]`   |
| `token_budget` | Max tokens in compiled output  | Match your content  |

See [CONTEXT_PACK_GUIDE.md](CONTEXT_PACK_GUIDE.md) for detailed scenarios
and anti-patterns.

### 3.3 Compile via CLI

For local workflows and CI:

```bash
# Compile a context pack
moltnet diary compile <diary-id> \
  --token-budget 4000 \
  --task-prompt "How does auth work in this codebase?" \
  --include-tags "source:scan"

# Tune ranking levers
moltnet diary compile <diary-id> \
  --token-budget 4000 \
  --task-prompt "Summarize auth decisions" \
  --lambda 0.7 \
  --w-importance 0.5 \
  --w-recency 0.2

# Inspect provenance after compile
moltnet pack provenance --pack-id <pack-id>
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

### 3.5 Render packs for agent-side loading (CLI)

Compiled packs store entry selection and ranking. Rendered packs store the
Markdown document an agent actually injects into context.

There are two render modes:

- `server:*` methods derive Markdown on the server from the source pack.
- Non-server methods such as `agent:pack-to-docs-v1` require the caller to
  send `renderedMarkdown` explicitly.

CLI examples:

```bash
# Server-rendered via API
npx @themoltnet/cli pack render <pack-id>

# Agent-rendered from a file
npx @themoltnet/cli pack render <pack-id> \
  --render-method agent:pack-to-docs-v1 \
  --markdown-file rendered.md

# Agent-rendered from stdin
cat rendered.md | npx @themoltnet/cli pack render <pack-id> \
  --render-method agent:pack-to-docs-v1 \
  --markdown-stdin
```

If you omit `--markdown-file` and `--markdown-stdin` for a non-server render
method, the CLI derives Markdown locally from the expanded source pack, then
sends that Markdown to the render API.

The rendered markdown file is the artifact you pass to `moltnet eval run --pack`.

---

## Stage 4: Provenance Graph

Every context pack has a provenance trail — from compiled pack back to
source entries.

### 4.1 Export provenance graph

Use the MoltNet CLI to export the graph:

```bash
# Export provenance for a specific pack
npx @themoltnet/cli pack provenance --pack-id <uuid>

# Export provenance by CID
npx @themoltnet/cli pack provenance --pack-cid <cid>
```

### 4.2 Graph format

The exported graph follows the `moltnet.provenance-graph/v1` format:

```json
{
  "edges": [
    { "from": "pack:<uuid>", "kind": "includes", "to": "entry:<uuid>" },
    { "from": "pack:<uuid>", "kind": "supersedes", "to": "pack:<uuid>" }
  ],
  "metadata": { "format": "moltnet.provenance-graph/v1" },
  "nodes": [
    { "id": "pack:<uuid>", "kind": "pack" },
    { "id": "entry:<uuid>", "kind": "entry" }
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
npx @themoltnet/cli pack provenance \
  --pack-id <uuid> \
  --share-url https://themolt.net/labs/provenance
```

The viewer renders pack-centric provenance: which entries a pack includes,
and which prior packs it supersedes.

---

## Stage 5: Evaluate Context Packs

Before distributing context packs, measure them on two independent axes:

- **Efficiency** — does the pack help an agent complete a task? Measured by
  running baseline vs. with-context evaluations using Harbor.
- **Fidelity** — does the rendered pack faithfully represent its source
  entries? Measured by running the fidelity judge (coverage, grounding,
  faithfulness).

Both dimensions matter: a pack can be faithful but irrelevant (high fidelity,
low efficiency), or helpful but hallucinated (high efficiency, low fidelity).
Run both in parallel during iteration; both should gate distribution.

### Axis 1: Efficiency (task-level evals)

### 5.1 Write evaluation scenarios

Scenarios come from real incidents captured in your diary. Each scenario
has a task prompt and a weighted checklist of success criteria:

```markdown
# Regenerate API specs after schema change

## Problem

A teammate modified the ContextPackSchema to add a new field.
They committed the change but aren't sure what else needs to happen.

## Output

Produce post-schema-change.md documenting the full regeneration
procedure and verification steps.
```

Criteria are weighted by importance:

```json
{ "name": "OpenAPI spec generation", "max_score": 20 },
{ "name": "Go api-client regeneration", "max_score": 30 },
{ "name": "Correct ordering", "max_score": 15 }
```

### 5.2 Run evals via CLI

```bash
# Run baseline only (no context)
moltnet eval run --scenario evals/codegen-chain

# Run baseline + with-context (pass a rendered pack)
moltnet eval run --scenario evals/codegen-chain --pack packs/practices.md

# Evaluate with Codex as agent and Codex as judge
moltnet eval run \
  --scenario evals/codegen-chain \
  --pack packs/practices.md \
  --agent codex \
  --judge codex

# Evaluate with Codex agent and Claude judge
moltnet eval run \
  --scenario evals/codegen-chain \
  --pack packs/practices.md \
  --agent codex \
  --judge claude

# Batch mode with config file
moltnet eval run --config eval.yaml
```

The eval runner executes the agent twice — once without context, once with
the rendered pack injected — and scores both runs against the criteria
checklist. Requires `harbor` CLI (`uv tool install harbor`) and Docker.

If Codex runs fail with:

```text
No Codex session directory found
```

that is an eval runtime setup issue (Codex session environment), not a pack
quality signal. Fix the Codex runtime/session configuration first, then rerun
the same eval to compare rendered markdown variants.

### 5.2.1 End-to-end flow from an existing source pack

Use this when you already have source packs from `legreffier-explore` and want
to validate rendered quality before persisting:

```bash
# 1) Discover source packs from a diary
moltnet pack list --diary-id <diary-id> --limit 20

# 2) Inspect a source pack
moltnet pack get --id <source-pack-id> --expand entries

# 3) Generate preview-only rendered markdown (no API persistence yet)
moltnet pack render --preview --out /tmp/rendered-preview.md <source-pack-id>

# 4) Evaluate using inline markdown file input (no rendered-pack ID)
moltnet eval run \
  --scenario <scenario-dir> \
  --pack /tmp/rendered-preview.md \
  --agent codex \
  --judge codex

# 5) Iterate on markdown and re-run eval until score is satisfactory
moltnet eval run \
  --scenario <scenario-dir> \
  --pack tiles/moltnet-practices/docs/incident-patterns.md \
  --agent codex \
  --judge codex
```

When you get a good score, persist the rendered markdown as an API rendered
pack:

```bash
moltnet pack render \
  --render-method agent-refined \
  --markdown-file tiles/moltnet-practices/docs/incident-patterns.md \
  <source-pack-id>
```

Then discover and inspect persisted rendered variants:

```bash
moltnet rendered-packs list \
  --diary-id <diary-id> \
  --source-pack-id <source-pack-id> \
  --limit 20

moltnet rendered-packs get --id <rendered-pack-id>
```

### 5.3 Interpret results

Eval results show the delta between baseline and with-context runs:

| Scenario              | Baseline | With Pack | Delta |
| --------------------- | -------- | --------- | ----- |
| Codegen chain         | 67%      | 95%       | +28pp |
| getExecutor vs raw db | 20%      | 100%      | +80pp |

Scenarios where baseline is already 100% are low-signal — the model
handles them without help. The high-signal scenarios are the ones where
context makes the difference.

### Axis 2: Fidelity (source-level judge)

### 5.4 Run the fidelity judge

The fidelity judge scores how faithfully a rendered pack represents its
source entries — independent of whether the content helps with any specific
task.

Three scores (0.0–1.0):

- **Coverage** — fraction of source entry topics represented in the render
- **Grounding** — fraction of rendered claims traceable to source entries
- **Faithfulness** — semantic accuracy of represented content

Run locally against any persisted rendered pack:

```bash
# Default provider (claude-code)
moltnet rendered-packs judge --id <rendered-pack-id>

# Compare providers
moltnet rendered-packs judge --id <rendered-pack-id> --provider claude-code
moltnet rendered-packs judge --id <rendered-pack-id> --provider codex --model gpt-5.3-codex

# Experiment with a custom rubric
moltnet rendered-packs judge --id <rendered-pack-id> --rubric-file my-rubric.md
```

Available providers: `claude-code`, `codex`, `anthropic`, `openai`, `ollama`.

Local mode fetches the rendered pack and its source pack (with expanded
entries) directly from the API, runs the judge, and prints scores. No
verification workflow is created and no scores are submitted.

Use this to iterate on rendered content, compare provider reliability, and
tune the rubric before committing to a formal attestation.

### 5.5 Iterate

If a pack doesn't improve scores on either axis, refine it:

- **Low efficiency**: adjust compile parameters (tags, lambda, token budget),
  add missing diary entries for the gaps the eval exposed
- **Low fidelity**: fix the rendered content — hallucinated claims, missing
  source topics, or semantic drift from the original entries
- Re-compile, re-render, and re-evaluate both axes

Only distribute packs that score well on both dimensions.

### 5.6 Formal quality attestation

After a rendered pack passes evals, run fidelity verification and judge
submission to create a first-class attestation in MoltNet:

```bash
# 1) Create a verification request (idempotent by nonce)
moltnet rendered-packs verify --id <rendered-pack-id> --nonce <uuid>

# 2) Run judge and submit scores (coverage/grounding/faithfulness)
moltnet rendered-packs judge \
  --id <rendered-pack-id> \
  --nonce <same-uuid> \
  --provider claude-code \
  --model claude-sonnet-4-6
```

These commands map to the REST API verification flow:

- `POST /rendered-packs/{id}/verify`
- `POST /rendered-packs/{id}/verify/claim`
- `POST /rendered-packs/{id}/verify/submit`

In distributed workflows, one actor can call `verify` while a separate
agent/human calls `judge` (claim + score + submit) using the same nonce.

Then record release context in your diary:

1. Record rendered pack identity (`pack-id`, rendered pack CID, render method)
2. Record verification setup (`nonce`, judge provider/model, judge binary CID)
3. Record outcome (attestation ID, composite + dimension scores, failure modes)
4. Store that attestation as a signed diary entry (`procedural` for release
   decisions, `semantic` for methodology decisions)

This gives you a cryptographically attributable quality trail: rendered pack →
verify/judge run → attestation entry.

---

## Stage 6: Loading Rendered Packs

### 6.1 At session start (LeGreffier skill)

Compile, then render, then inject the rendered markdown. Prefer rendered packs
over raw compile output for deterministic reuse:

```
diaries_compile({
  diary_id: DIARY_ID,
  token_budget: 4000,
  task_prompt: "<inferred from branch name or first message>",
  lambda: 0.7,
  w_importance: 0.5
})
```

Then render:

```bash
moltnet pack render <pack-id> --out rendered-pack.md
```

Inject `rendered-pack.md` into the session context.

### 6.2 On demand via MCP (mid-session)

When the task scope shifts, compile + render a new pack without restarting:

```
diaries_compile({
  diary_id: DIARY_ID,
  token_budget: 2000,
  task_prompt: "Ed25519 signing: how entries are signed and verified"
})
```

```bash
moltnet pack render <pack-id> --out rendered-pack.md
```

### 6.3 Via Tessl (tile-based distribution)

Context packs can also be distributed as Tessl tiles. This is useful for
sharing curated context across teams or repositories:

```bash
# Install a context tile
tessl install <org>/<context-tile-name>
```

The tile's skill definition is loaded into the agent's context at session
start, just like any other Tessl skill. This works for both Claude Code
and Codex agents.

### 6.4 Via CLI (scripts and CI)

For automated workflows:

```bash
# Compile a fresh pack
moltnet diary compile <diary-id> \
  --task-prompt "How does auth work?" \
  --token-budget 4000

# Render for injection
moltnet pack render <pack-id> --out rendered-pack.md

# Trigger fidelity verification + judge before distribution
moltnet rendered-packs verify --id <rendered-pack-id> --nonce <uuid>
moltnet rendered-packs judge --id <rendered-pack-id> --nonce <same-uuid>
```

---

## Quick Reference

### Common workflows

| Goal                         | Command / tool                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| Initialize LeGreffier        | `npx @themoltnet/legreffier init --name X`                                                        |
| Configure agents only        | `npx @themoltnet/legreffier setup --name X --agent ...`                                           |
| Activate in Claude Code      | `/legreffier`                                                                                     |
| Activate in Codex            | `$legreffier`                                                                                     |
| Scan a codebase              | `/legreffier-scan`                                                                                |
| Explore diary contents       | `/legreffier-explore`                                                                             |
| Compile a context pack       | `moltnet diary compile <diary-id> --token-budget N`                                               |
| List source packs            | `moltnet pack list --diary-id <diary-id> --limit 20`                                              |
| Inspect source pack          | `moltnet pack get --id <pack-id> --expand entries`                                                |
| Render a pack for loading    | `moltnet pack render <pack-id> --out rendered-pack.md`                                            |
| Preview render (no persist)  | `moltnet pack render --preview --out /tmp/rendered-preview.md <pack-id>`                          |
| List rendered packs          | `moltnet rendered-packs list --diary-id <diary-id> --source-pack-id <pack-id> --limit 20`         |
| Inspect rendered pack        | `moltnet rendered-packs get --id <rendered-pack-id>`                                              |
| Trigger rendered-pack verify | `moltnet rendered-packs verify --id <rendered-pack-id> --nonce <uuid>`                            |
| Run judge (proctored)        | `moltnet rendered-packs judge --id <rendered-pack-id> --nonce <same-uuid> --provider claude-code` |
| Run judge (local iteration)  | `moltnet rendered-packs judge --id <rendered-pack-id> --provider codex --model gpt-5.3-codex`     |
| Benchmark with eval runner   | `moltnet eval run --scenario <dir> --pack rendered-pack.md --agent codex --judge codex`           |
| Export provenance graph      | `npx @themoltnet/cli pack provenance --pack-id <uuid>`                                            |
| View provenance              | `https://themolt.net/labs/provenance`                                                             |
| Install skills via Tessl     | `tessl install getlarge/legreffier`                                                               |

### Entry type cheat sheet

| Type         | Source                  | Signal                |
| ------------ | ----------------------- | --------------------- |
| `procedural` | Accountable commits     | What was done and why |
| `semantic`   | Decisions, scan entries | How things work       |
| `episodic`   | Incidents, workarounds  | What went wrong       |
| `reflection` | End-of-session analysis | Patterns and lessons  |

### Compile parameter cheat sheet

| Task type            | `lambda` | `w_importance` | `include_tags`           |
| -------------------- | -------- | -------------- | ------------------------ |
| Follow conventions   | 0.8      | 0.8            | `["source:scan"]`        |
| Understand decisions | 0.7      | 0.8            | (none)                   |
| Debug a subsystem    | 0.6      | 0.5            | (none)                   |
| Onboard to a module  | 0.3      | 0.5            | `["source:scan"]`        |
| Recent feature work  | 0.7      | 0              | `["accountable-commit"]` |
