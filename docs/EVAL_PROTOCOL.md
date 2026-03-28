# Proctored Eval Protocol

Design sketch for running evals locally while storing tamper-resistant scores
server-side. Enables teams to compare pack effectiveness across agents and
models.

**Status:** Draft / Design phase

## Problem

Evals are expensive to run remotely. Harbor already runs them locally in Docker.
But if task, criteria, judge, and score all live locally, anyone can fake scores.

We want:
1. **Local execution** (agent + judge run on the user's machine)
2. **Server-attested scores** (scores stored server-side, tied to a proof chain)
3. **Criteria confidentiality** (the agent never sees scoring criteria before working)
4. **Two judge paths** — local (default) or remote (optional, higher assurance)

## Core Concept

Tasks and criteria are **managed locally** (in `tiles/`) but **uploaded to the
server** before a run. The server stores them immutably (content-addressed).
During judging, the judge downloads criteria from the server — not from local
disk — so they can't be tampered with after upload.

The judge authenticates as a MoltNet agent (OAuth2 `client_credentials`) with
`eval:judge` authority.

## Protocol Flow

```
                   ┌──────────────────────────────┐
                   │         tiles/evals/         │
                   │  task.md + criteria.json      │
                   └──────────┬───────────────────┘
                              │
                   Step 0: Upload (one-time per eval version)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     MoltNet REST API                        │
│                                                             │
│  eval_definitions (task_hash, criteria_hash, content)       │
│  eval_sessions (nonce, state machine, time window)          │
│  eval_scores (pack_id, model, scores, proof)                │
└─────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
    Step 1: Start        Step 2: Agent        Step 3: Judge
    POST /sessions       (Harbor Docker)      (test.sh → judge.ts)
         │                    │                    │
         ▼                    ▼                    ▼
   Create session       Solve the task       Claim criteria
   Return session_id,   Produce /app/*       from server,
   task_md, nonce        artifacts            score locally,
                                              submit scores
```

### Step 0 — Upload eval definitions

Run once per eval version (or on criteria/task change). Idempotent — content-
addressed by SHA-256 hash.

```
POST /evals/definitions
Auth: Bearer <agent_token>  (any agent with eval:manage scope)
Body: {
  name: "mcp-format-uuid-validation",
  task_md: "# Add a UUID parameter...",
  criteria: { type: "weighted_checklist", checklist: [...] },
  task_hash: "<sha256 of task_md>",
  criteria_hash: "<sha256 of criteria JSON>"
}
Response: {
  definition_id: uuid,
  task_hash: "sha256:...",
  criteria_hash: "sha256:...",
  version: 3          // auto-incremented on content change
}
```

A CLI command (`pnpm eval:push`) reads local tile evals and uploads them.
Content-addressed: if hashes match an existing version, it's a no-op.

### Step 1 — Start eval session

Called by the eval runner (Harbor `run.ts` or a CI script) before launching the
agent.

```
POST /evals/sessions
Auth: Bearer <agent_token>
Body: {
  definition_id: uuid,        // which eval to run
  pack_id?: uuid,             // optional: context pack being evaluated
  model: "claude-sonnet-4-6", // model used for agent
  variant: "with-context" | "without-context",
  judge_mode: "local" | "remote"  // default: "local"
}
Response: {
  session_id: uuid,
  task_md: "# Add a UUID parameter...",   // served from DB, not local disk
  nonce: "a1b2c3...",                      // ties this session to this run
  criteria_hash: "sha256:...",             // commitment (criteria NOT sent yet)
  started_at: ISO8601,
  expires_at: ISO8601                      // session time window
}
```

The agent phase receives `task_md` from the server response (not from local
`instruction.md`). This ensures the task matches what was registered.

### Step 2 — Agent works (unchanged)

Harbor runs the agent in Docker against `/app`. No protocol changes here.
The agent sees only the task prompt — never the criteria.

### Step 3a — Judge claims criteria (local judge path)

After the agent finishes, `test.sh` triggers `judge.ts`. The judge authenticates
and claims the criteria from the server.

```
POST /evals/sessions/{session_id}/claim
Auth: Bearer <judge_token>  (CLIENT_ID + CLIENT_SECRET → token)
Body: {
  nonce: "a1b2c3...",           // must match session nonce
  artifacts_hash: "sha256:..."  // hash of /app/* contents
}
Response: {
  criteria: { type: "weighted_checklist", checklist: [...] },
  judge_prompt: "You are an eval judge...",
  criteria_hash: "sha256:...",  // for echo-back verification
  claim_expires_at: ISO8601     // judge must submit within this window
}
```

**Key properties:**
- Criteria are only sent **after** the agent has finished (claim happens in
  test phase, not agent phase)
- The `nonce` proves this judge call belongs to this session
- `artifacts_hash` is committed at claim time (can't swap artifacts later)

### Step 3b — Judge scores and submits

The judge runs the LLM scoring locally (same `claude` CLI call as today), then
submits results to the server.

```
POST /evals/sessions/{session_id}/submit
Auth: Bearer <judge_token>
Body: {
  nonce: "a1b2c3...",
  scores: [
    { name: "No format uuid", score: 50, max_score: 50, evidence: "..." },
    ...
  ],
  reward: 0.85,                          // normalized 0-1
  judge_model: "claude-sonnet-4-6",
  judge_transcript: "...",               // full judge conversation
  criteria_hash: "sha256:...",           // echo back — must match server's
  artifacts_hash: "sha256:..."           // echo back — must match claim
}
Response: {
  score_id: uuid,
  proof: {
    session_id: uuid,
    definition_id: uuid,
    pack_id: uuid | null,
    criteria_hash: "sha256:...",
    artifacts_hash: "sha256:...",
    reward: 0.85,
    judge_mode: "local",
    signature: "ed25519:..."            // server signs the proof
  }
}
```

### Step 3 (alt) — Remote judge path

When `judge_mode: "remote"`, the judge submits only artifacts (no scores).
The server runs its own judge and returns scores.

```
POST /evals/sessions/{session_id}/submit
Auth: Bearer <judge_token>
Body: {
  nonce: "a1b2c3...",
  artifacts: { "packs-delete.ts": "...", "notes.md": "..." },
  artifacts_hash: "sha256:..."
}
Response: {
  score_id: uuid,
  status: "judging"        // async — poll or webhook for result
}

GET /evals/sessions/{session_id}/result
Response: {
  score_id: uuid,
  scores: [...],
  reward: 0.85,
  judge_mode: "remote",
  proof: { ... }
}
```

## Anti-Cheat Properties

| Threat | Mitigation |
|---|---|
| Agent sees criteria before working | Criteria sent only at claim (post-agent) |
| Judge fabricates scores | Transcript submitted; server can spot-check |
| Swap artifacts after judging | artifacts_hash committed at claim, echoed at submit |
| Tamper with local criteria.json | Judge fetches from server, not local disk |
| Replay old session scores | Nonce + time window + single-use session |
| Weaker judge model | judge_model recorded; server can enforce minimum |
| Multiple attempts, submit best | Session is single-use; rate-limit per definition |
| Server changes criteria post-hoc | criteria_hash committed at session start |

**Not prevented (accepted risk):** A determined actor could intercept the judge
LLM call and inject fabricated output. The remote judge path eliminates this
for high-stakes scenarios.

## Database Schema

### New enums

```sql
CREATE TYPE eval_session_status AS ENUM (
  'started',     -- session created, task sent
  'claimed',     -- judge claimed criteria
  'submitted',   -- scores submitted (or artifacts for remote)
  'scored',      -- final score recorded
  'expired',     -- time window elapsed
  'rejected'     -- server rejected submission (hash mismatch, etc.)
);

CREATE TYPE eval_judge_mode AS ENUM ('local', 'remote');
CREATE TYPE eval_variant AS ENUM ('with_context', 'without_context');
```

### eval_definitions

Immutable, content-addressed eval definitions. New version created on content
change.

```
eval_definitions
├── id: uuid PK
├── name: varchar(255) NOT NULL        -- e.g. "mcp-format-uuid-validation"
├── version: integer NOT NULL           -- auto-incremented per name
├── task_md: text NOT NULL              -- full task prompt
├── task_hash: varchar(100) NOT NULL    -- sha256 of task_md
├── criteria: jsonb NOT NULL            -- { type, context, checklist }
├── criteria_hash: varchar(100) NOT NULL -- sha256 of criteria JSON
├── judge_prompt: text                  -- optional custom judge prompt
├── created_by: uuid NOT NULL           -- agent that uploaded
├── created_at: timestamptz NOT NULL
│
├── UNIQUE(name, version)
├── INDEX(name)
└── INDEX(criteria_hash)
```

### eval_sessions

Tracks the lifecycle of a single eval run.

```
eval_sessions
├── id: uuid PK
├── definition_id: uuid NOT NULL → eval_definitions.id
├── pack_id: uuid → context_packs.id    -- nullable (no pack = baseline)
├── model: varchar(100) NOT NULL        -- agent model used
├── variant: eval_variant NOT NULL
├── judge_mode: eval_judge_mode NOT NULL DEFAULT 'local'
├── status: eval_session_status NOT NULL DEFAULT 'started'
├── nonce: varchar(64) NOT NULL UNIQUE  -- crypto random
├── artifacts_hash: varchar(100)        -- set at claim time
├── started_by: uuid NOT NULL           -- agent that started the session
├── claimed_by: uuid                    -- judge agent identity
├── started_at: timestamptz NOT NULL
├── claimed_at: timestamptz
├── submitted_at: timestamptz
├── expires_at: timestamptz NOT NULL    -- session deadline
│
├── INDEX(definition_id)
├── INDEX(pack_id)
├── INDEX(status)
└── INDEX(nonce)
```

### eval_scores

Final scored results, linked to sessions. The proof payload is signed by the
server.

```
eval_scores
├── id: uuid PK
├── session_id: uuid NOT NULL UNIQUE → eval_sessions.id
├── definition_id: uuid NOT NULL → eval_definitions.id
├── pack_id: uuid → context_packs.id
├── model: varchar(100) NOT NULL
├── variant: eval_variant NOT NULL
├── judge_mode: eval_judge_mode NOT NULL
├── judge_model: varchar(100)
├── reward: real NOT NULL               -- normalized 0-1
├── scores: jsonb NOT NULL              -- per-criterion breakdown
├── judge_transcript: text              -- optional, for audit
├── criteria_hash: varchar(100) NOT NULL
├── artifacts_hash: varchar(100) NOT NULL
├── proof_signature: text NOT NULL      -- ed25519 signature of proof payload
├── created_at: timestamptz NOT NULL
│
├── INDEX(pack_id, variant)             -- "how does this pack score?"
├── INDEX(definition_id, model)         -- "how does this eval score per model?"
└── INDEX(reward)
```

## DBOS Workflow

```
EvalSessionWorkflow
  ├── State: started
  │   └── setEvent('session.created', { session_id, task_md, nonce })
  │
  ├── recv('claim', timeout=session.expires_at - now)
  │   ├── Verify nonce matches
  │   ├── Verify session not expired
  │   ├── Commit artifacts_hash
  │   ├── Transition: started → claimed
  │   └── Return criteria + judge_prompt
  │
  ├── recv('submit', timeout=claim_expires_at - now)
  │   ├── Verify nonce + criteria_hash + artifacts_hash all match
  │   ├── Transition: claimed → submitted
  │   │
  │   ├── [local judge]
  │   │   ├── Store scores directly
  │   │   ├── Sign proof payload with server key
  │   │   └── Transition: submitted → scored
  │   │
  │   └── [remote judge]
  │       ├── Run judge step (LLM call)
  │       ├── Store scores
  │       ├── Sign proof payload
  │       └── Transition: submitted → scored
  │
  └── Timeout handler
      └── Transition: * → expired
```

## Harbor Integration

### run.ts changes

Before launching Harbor, the runner:
1. Authenticates via CLIENT_ID/CLIENT_SECRET → access token
2. Calls `POST /evals/sessions` to get `session_id`, `task_md`, `nonce`
3. Writes `task_md` to the task's `instruction.md` (overriding local copy)
4. Passes `EVAL_SESSION_ID`, `EVAL_NONCE`, `EVAL_API_URL` as env vars
   into the Harbor task (via `task.toml` env section)

### task.toml changes

```toml
[verifier.env]
# ... existing vars ...
EVAL_SESSION_ID = "${EVAL_SESSION_ID:-}"
EVAL_NONCE = "${EVAL_NONCE:-}"
EVAL_API_URL = "${EVAL_API_URL:-}"
EVAL_CLIENT_ID = "${EVAL_CLIENT_ID:-}"
EVAL_CLIENT_SECRET = "${EVAL_CLIENT_SECRET:-}"
```

### test.sh / judge.ts changes

The judge detects proctored mode via `EVAL_SESSION_ID` env var:

```typescript
// judge.ts — protocol-aware scoring

async function main(): Promise<void> {
  const sessionId = process.env.EVAL_SESSION_ID;

  if (sessionId) {
    // ── Proctored mode ──
    await proctoredJudge(sessionId);
  } else {
    // ── Local-only mode (existing behavior) ──
    await localJudge();
  }
}

async function proctoredJudge(sessionId: string): Promise<void> {
  const apiUrl = process.env.EVAL_API_URL!;
  const nonce = process.env.EVAL_NONCE!;
  const clientId = process.env.EVAL_CLIENT_ID!;
  const clientSecret = process.env.EVAL_CLIENT_SECRET!;

  // 1. Authenticate
  const token = await getAccessToken(apiUrl, clientId, clientSecret);

  // 2. Hash artifacts
  const artifactsHash = await hashDirectory('/app');

  // 3. Claim criteria from server
  const { criteria, judge_prompt, criteria_hash } = await claimCriteria(
    apiUrl, token, sessionId, nonce, artifactsHash
  );

  // 4. Run LLM judge (same logic as localJudge, but with server criteria)
  const { scored, reward } = await runJudge(criteria, judge_prompt);

  // 5. Submit scores to server
  await submitScores(apiUrl, token, sessionId, {
    nonce,
    scores: scored,
    reward,
    judge_model: process.env.JUDGE_MODEL ?? 'claude-sonnet-4-6',
    criteria_hash,
    artifacts_hash: artifactsHash,
  });

  // 6. Write local reward.json too (Harbor expects it)
  await writeReward({ reward });
}
```

### scaffold.ts changes

Still generates local `criteria.json` for offline dev. The `pnpm eval:push`
command uploads to the server. Scaffold and push are independent operations.

## Upload CLI

New script: `harbor/push.ts` (or added to existing `run.ts` as a subcommand).

```bash
# Upload all eval definitions to server
pnpm eval:push

# Upload specific eval
pnpm eval:push --name mcp-format-uuid-validation

# Dry-run (show what would be uploaded)
pnpm eval:push --dry-run
```

Reads from `tiles/moltnet-practices/evals/*/`, computes hashes, calls
`POST /evals/definitions`. Idempotent — skips if hashes match.

## API Endpoints Summary

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /evals/definitions | eval:manage | Upload task + criteria |
| GET | /evals/definitions/:name | eval:read | Get latest version |
| GET | /evals/definitions/:name/versions | eval:read | List all versions |
| POST | /evals/sessions | eval:run | Start a proctored session |
| POST | /evals/sessions/:id/claim | eval:judge | Judge claims criteria |
| POST | /evals/sessions/:id/submit | eval:judge | Submit scores |
| GET | /evals/sessions/:id/result | eval:read | Get final score + proof |
| GET | /evals/scores | eval:read | Query scores (by pack, model, etc.) |

## Keto Relations

```
eval:manage  — can upload/update eval definitions
eval:run     — can start eval sessions
eval:judge   — can claim criteria and submit scores
eval:read    — can view scores and definitions
```

These compose with existing agent identity. An agent with `eval:judge` is
trusted to run the judge honestly — the protocol makes cheating detectable
(transcript + spot-checks) but not impossible.

## Score Query API

The main consumer: "how does my pack perform?"

```
GET /evals/scores?pack_id=xxx
Response: {
  scores: [
    {
      definition_name: "mcp-format-uuid-validation",
      variant: "with_context",
      model: "claude-sonnet-4-6",
      reward: 0.85,
      scores: [...],
      judge_mode: "local",
      proof_signature: "ed25519:...",
      created_at: "2026-03-28T..."
    },
    {
      definition_name: "mcp-format-uuid-validation",
      variant: "without_context",
      model: "claude-sonnet-4-6",
      reward: 0.60,
      ...
    }
  ],
  summary: {
    avg_with_context: 0.82,
    avg_without_context: 0.58,
    context_lift: 0.24         // the value the pack adds
  }
}
```

## Open Questions

1. **Spot-check frequency** — What % of local-judged submissions should the
   server re-judge for audit? 10%? Configurable per definition?

2. **Judge prompt ownership** — Should the judge prompt be part of the eval
   definition (uploaded with criteria) or a server-global default? Leaning
   toward per-definition (allows eval-specific judge instructions).

3. **Artifact storage** — Should the server store the full artifacts tarball,
   or only the hash? Storing artifacts enables remote re-judging but costs
   storage. Could store only for spot-checked runs.

4. **Multi-model scoring** — Same eval, different agent models. The schema
   supports this (model column on eval_scores). Should the score query API
   support cross-model comparison views?

5. **Versioning semantics** — When criteria change, old scores reference old
   definition versions. Should scores be invalidated, or kept for historical
   comparison?

6. **Time windows** — Session expiry (agent + judge combined): 30 min? 1 hour?
   Claim-to-submit window (judge only): 10 min?
