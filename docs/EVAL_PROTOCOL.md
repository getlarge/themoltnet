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
server** before a run. The server stores them immutably (content-addressed by
CID, same pattern as `context_packs.packCid`). During judging, the judge
downloads criteria from the server — not from local disk — so they can't be
tampered with after upload.

The judge authenticates as a MoltNet agent (OAuth2 `client_credentials`) with
`eval:judge` authority.

## Entity Model

Four entities, each with a clear role:

```
┌─────────────────────────┐
│         evals           │  "What are we testing?"
│─────────────────────────│
│ id: uuid PK             │  ← stable identity, used in all URLs
│ name: varchar           │  ← display name (searchable, not a URL param)
│ description: text       │  ← human-readable purpose
│ created_by: uuid        │
│ created_at: timestamptz │
└────────────┬────────────┘
             │
             │ 1:N  (one eval, many task versions)
             ▼
┌──────────────────────────────┐
│        eval_tasks            │  "Version N of task + criteria"
│──────────────────────────────│
│ id: uuid PK                  │
│ eval_id: uuid FK → evals     │
│ eval_cid: varchar (UQ)       │  ← DAG-CBOR CID of { task_md, criteria }
│ eval_codec: varchar           │  ← 'dag-cbor'
│ task_md: text                 │  ← the prompt the agent sees
│ criteria: jsonb               │  ← { type, context, checklist }
│ judge_prompt: text            │  ← optional per-task judge instructions
│ created_by: uuid              │
│ created_at: timestamptz       │
└──────────────┬───────────────┘
               │
               │ 1:N  (one task version, many sessions)
               ▼
┌─────────────────────────┐        ┌──────────────────┐
│     eval_sessions       │  N:1   │  context_packs   │ (existing)
│─────────────────────────│ ──────►│                  │
│ id: uuid PK             │        └──────────────────┘
│ task_id: uuid FK        │  ← which task version was used
│ pack_id: uuid FK (null) │  ← the pack being evaluated
│ model: varchar          │  ← agent model, e.g. "claude-sonnet-4-6"
│ judge_mode: enum        │  ← local | remote
│ status: enum            │  ← pending → running → scored | expired
│ nonce: varchar (UQ)     │  ← binds the two variant runs
│ started_by: uuid        │
│ started_at: timestamptz │
│ expires_at: timestamptz │
└────────────┬────────────┘
             │
             │ 1:N  (one session, two scores)
             ▼
┌───────────────────────────┐
│       eval_scores         │  "How did each variant score?"
│───────────────────────────│
│ id: uuid PK               │
│ session_id: uuid FK       │
│ variant: enum             │  ← with_context | without_context
│ status: enum              │  ← started → claimed → scored | expired
│ nonce: varchar (UQ)       │  ← per-score nonce for claim/submit
│ artifacts_hash: varchar   │  ← SHA-256 of /app/* at claim time
│ reward: real              │  ← normalized 0-1
│ scores: jsonb             │  ← per-criterion { name, score, max, evidence }
│ judge_model: varchar      │
│ judge_transcript: text    │  ← full judge LLM conversation (audit)
│ criteria_hash: varchar    │  ← echo-back verification against task's criteria
│ proof_signature: text     │  ← server Ed25519 signature of proof payload
│ claimed_by: uuid          │  ← judge agent identity
│ metadata: jsonb           │  ← ATIF telemetry (tokens, cost, steps, duration)
│ started_at: timestamptz   │
│ claimed_at: timestamptz   │
│ submitted_at: timestamptz │
│ UNIQUE(session_id, variant)
└───────────────────────────┘
```

### Why four entities?

- **evals** is the stable anchor — one row per eval name, never mutated.
  "All scores for mcp-format-uuid-validation" is a single FK join regardless
  of how many times the task or criteria changed.

- **eval_tasks** are immutable, CID-addressed snapshots of `{ task_md, criteria }`.
  Each content change produces a new row with a new CID. Full version history
  is preserved — no data is overwritten. Sessions reference a specific task
  version, so you always know exactly which criteria a score was judged against.

- **eval_sessions** is the evaluation campaign — "test pack X on eval Y
  (task version Z) with model W." It groups the with/without context variant
  runs into a single logical unit. Both variants must complete.

- **eval_scores** are the individual variant results — one per variant per
  session. Each score has its own claim/submit lifecycle, nonce, and proof
  signature. The `metadata` JSONB holds ATIF telemetry (tokens, cost, steps).

### Task CID

Same content-addressing pattern as `context_packs.packCid`:

```typescript
import { computePackCid } from '@moltnet/crypto-service';

// CID over canonical { task_md, criteria } — deterministic
const evalCid = await computePackCid({
  task_md: taskMd,
  criteria: canonicalJsonSort(criteria),
});
```

On upload (`PUT /evals/:name/tasks`):
- Compute CID over `{ task_md, criteria }`
- If CID already exists as an eval_task → no-op (idempotent)
- If CID is new → insert new eval_task row under the eval

Sessions reference `task_id` (FK to the specific version). Querying
"all scores for eval X" joins through evals → eval_tasks → sessions.
Querying "scores for eval X at a specific task version" goes directly
through eval_tasks → sessions.

### Session-Score relationship

A session always expects **exactly two scores** (with_context + without_context).
The session transitions to `scored` only when both variant scores are submitted.
This ensures the context lift calculation always has both sides.

```
Session lifecycle:
  pending → running (at least one score started)
          → scored  (both variant scores submitted)
          → expired (time window elapsed before completion)
```

```
Score lifecycle (per variant):
  started → claimed (judge fetched criteria)
          → scored  (judge submitted results)
          → expired (claim window elapsed)
```

## Protocol Flow

```
                   ┌──────────────────────────────┐
                   │         tiles/evals/         │
                   │  task.md + criteria.json      │
                   └──────────┬───────────────────┘
                              │
                   Step 0: Upload (idempotent, CID-addressed)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     MoltNet REST API                        │
│  evals ──► eval_tasks ──► eval_sessions ──► eval_scores     │
└─────────────────────────────────────────────────────────────┘

Step 1: Start session (for a pack + task version + model)
  ├── Creates session with two score slots (with/without context)
  └── Returns session_id, task_md, per-variant nonces

Step 2: Agent works (Harbor Docker, per variant — unchanged)

Step 3: Judge claims + submits (per variant, via test.sh → judge.ts)
  ├── POST /sessions/:id/scores/:variant/claim → gets criteria
  └── POST /sessions/:id/scores/:variant/submit → sends results + ATIF metrics
```

### Step 0 — Create eval + upload tasks

Two calls: first create the eval (once), then push task versions (idempotent).

```
POST /evals
Auth: Bearer <agent_token>  (eval:manage scope)
Body: {
  name: "mcp-format-uuid-validation",
  description: "Tests whether the agent avoids format: 'uuid' in MCP schemas"
}
Response: {
  id: uuid,
  name: "mcp-format-uuid-validation",
  created_at: ISO8601
}
```

```
POST /evals/:id/tasks
Auth: Bearer <agent_token>  (eval:manage scope)
Body: {
  task_md: "# Add a UUID parameter...",
  criteria: { type: "weighted_checklist", checklist: [...] },
  judge_prompt: "You are an eval judge..."   // optional
}
Response: {
  task_id: uuid,
  eval_cid: "bafy...",
  created: true | false    // false = CID already existed (no-op)
}
```

CID-addressed: if `{ task_md, criteria }` hashes to an existing CID under
this eval, no new row is created.

A CLI command (`pnpm eval:push`) reads local tile evals and uploads them.
It creates evals that don't exist yet and pushes task versions for each.

### Step 1 — Start eval session

Called by the eval runner (Harbor `run.ts` or a CI script) before launching
the agent.

```
POST /evals/sessions
Auth: Bearer <agent_token>  (eval:run scope)
Body: {
  task_id: uuid,                 // specific task version to run against
  pack_id?: uuid,                // context pack being evaluated (null = no pack)
  model: "claude-sonnet-4-6",   // model used for agent
  judge_mode: "local" | "remote"
}
Response: {
  session_id: uuid,
  task_md: "# Add a UUID parameter...",
  variants: {
    with_context: {
      score_id: uuid,
      nonce: "a1b2c3..."
    },
    without_context: {
      score_id: uuid,
      nonce: "d4e5f6..."
    }
  },
  started_at: ISO8601,
  expires_at: ISO8601
}
```

The runner receives `task_md` from the server (not local disk) and separate
nonces for each variant. It then launches two Harbor runs — one with context
injected, one without.

Alternatively, the runner can pass `eval_cid` instead of `task_id` — the
server resolves it to the matching eval_task row.

### Step 2 — Agent works (unchanged)

Harbor runs the agent in Docker against `/app`. No protocol changes here.
The agent sees only the task prompt — never the criteria.

### Step 3a — Judge claims criteria

After the agent finishes a variant, `test.sh` triggers `judge.ts`. The judge
authenticates and claims criteria for that specific variant.

```
POST /evals/sessions/{session_id}/scores/{variant}/claim
Auth: Bearer <judge_token>  (eval:judge scope, via CLIENT_ID + CLIENT_SECRET)
Body: {
  nonce: "a1b2c3...",
  artifacts_hash: "sha256:..."
}
Response: {
  criteria: { type: "weighted_checklist", checklist: [...] },
  judge_prompt: "You are an eval judge...",
  criteria_hash: "sha256:...",
  claim_expires_at: ISO8601
}
```

### Step 3b — Judge scores and submits

```
POST /evals/sessions/{session_id}/scores/{variant}/submit
Auth: Bearer <judge_token>
Body: {
  nonce: "a1b2c3...",
  scores: [
    { name: "No format uuid", score: 50, max_score: 50, evidence: "..." },
    ...
  ],
  reward: 0.85,
  judge_model: "claude-sonnet-4-6",
  judge_transcript: "...",
  criteria_hash: "sha256:...",
  artifacts_hash: "sha256:...",
  metadata?: { turns?: number, cost_usd?: number, duration_ms?: number }
}
Response: {
  score_id: uuid,
  proof: {
    session_id: uuid,
    eval_cid: "bafy...",
    pack_id: uuid | null,
    variant: "with_context",
    criteria_hash: "sha256:...",
    artifacts_hash: "sha256:...",
    reward: 0.85,
    judge_mode: "local",
    signature: "ed25519:..."
  },
  session_complete: true | false   // true when both variants scored
}
```

When `session_complete: true`, the session transitions to `scored` and the
context lift is calculable.

### Step 3 (alt) — Remote judge path

When `judge_mode: "remote"`, the judge submits only artifacts (no scores).
The server runs its own judge and returns scores asynchronously.

```
POST /evals/sessions/{session_id}/scores/{variant}/submit
Auth: Bearer <judge_token>
Body: {
  nonce: "a1b2c3...",
  artifacts: { "packs-delete.ts": "...", "notes.md": "..." },
  artifacts_hash: "sha256:..."
}
Response: {
  score_id: uuid,
  status: "judging"
}
```

## Anti-Cheat Properties

| Threat | Mitigation |
|---|---|
| Agent sees criteria before working | Criteria sent only at claim (post-agent) |
| Judge fabricates scores | Transcript submitted; server can spot-check |
| Swap artifacts after judging | artifacts_hash committed at claim, echoed at submit |
| Tamper with local criteria.json | Judge fetches from server, not local disk |
| Submit only good variant | Session requires both variants to complete |
| Replay old session scores | Nonce + time window + single-use session |
| Weaker judge model | judge_model recorded; server can enforce minimum |
| Multiple attempts, submit best | Session is single-use; rate-limit per definition |
| Server changes criteria post-hoc | eval_tasks are immutable (CID-addressed, append-only) |

**Not prevented (accepted risk):** A determined actor could intercept the judge
LLM call and inject fabricated output. The remote judge path eliminates this
for high-stakes scenarios.

## Database Schema (Drizzle)

### New enums

```typescript
export const evalSessionStatusEnum = pgEnum('eval_session_status', [
  'pending',   // session created, waiting for runs
  'running',   // at least one variant started
  'scored',    // both variants scored
  'expired',   // time window elapsed
]);

export const evalScoreStatusEnum = pgEnum('eval_score_status', [
  'started',   // score slot created
  'claimed',   // judge claimed criteria
  'scored',    // judge submitted results
  'expired',   // claim window elapsed
]);

export const evalJudgeModeEnum = pgEnum('eval_judge_mode', ['local', 'remote']);
export const evalVariantEnum = pgEnum('eval_variant', [
  'with_context',
  'without_context',
]);
```

### evals

```typescript
export const evals = pgTable(
  'evals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Display name — searchable, not used as URL identifier.
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    nameIdx: index('evals_name_idx').on(table.name),
    createdByIdx: index('evals_created_by_idx').on(table.createdBy),
  }),
);
```

### eval_tasks

```typescript
export const evalTasks = pgTable(
  'eval_tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    evalId: uuid('eval_id')
      .notNull()
      .references(() => evals.id, { onDelete: 'cascade' }),
    // DAG-CBOR CID of { task_md, criteria } — immutable, unique.
    evalCid: varchar('eval_cid', { length: 100 }).notNull(),
    evalCodec: varchar('eval_codec', { length: 50 })
      .default('dag-cbor')
      .notNull(),
    taskMd: text('task_md').notNull(),
    criteria: jsonb('criteria').notNull(),
    judgePrompt: text('judge_prompt'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    evalCidUniqueIdx: uniqueIndex('eval_tasks_eval_cid_unique_idx').on(
      table.evalCid,
    ),
    evalIdx: index('eval_tasks_eval_idx').on(table.evalId),
  }),
);
```

### eval_sessions

```typescript
export const evalSessions = pgTable(
  'eval_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => evalTasks.id),
    packId: uuid('pack_id').references(() => contextPacks.id),
    model: varchar('model', { length: 100 }).notNull(),
    judgeMode: evalJudgeModeEnum('judge_mode').default('local').notNull(),
    status: evalSessionStatusEnum('status').default('pending').notNull(),
    nonce: varchar('nonce', { length: 64 }).notNull(),
    startedBy: uuid('started_by').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    nonceUniqueIdx: uniqueIndex('eval_sessions_nonce_unique_idx').on(
      table.nonce,
    ),
    taskIdx: index('eval_sessions_task_idx').on(table.taskId),
    packIdx: index('eval_sessions_pack_idx').on(table.packId),
    statusIdx: index('eval_sessions_status_idx').on(table.status),
  }),
);
```

### eval_scores

```typescript
export const evalScores = pgTable(
  'eval_scores',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => evalSessions.id, { onDelete: 'cascade' }),
    variant: evalVariantEnum('variant').notNull(),
    status: evalScoreStatusEnum('status').default('started').notNull(),
    nonce: varchar('nonce', { length: 64 }).notNull(),
    artifactsHash: varchar('artifacts_hash', { length: 100 }),
    reward: real('reward'),
    scores: jsonb('scores'),
    judgeModel: varchar('judge_model', { length: 100 }),
    judgeTranscript: text('judge_transcript'),
    criteriaHash: varchar('criteria_hash', { length: 100 }),
    proofSignature: text('proof_signature'),
    claimedBy: uuid('claimed_by'),
    metadata: jsonb('metadata'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
  },
  (table) => ({
    sessionVariantUniqueIdx: uniqueIndex(
      'eval_scores_session_variant_unique_idx',
    ).on(table.sessionId, table.variant),
    nonceUniqueIdx: uniqueIndex('eval_scores_nonce_unique_idx').on(
      table.nonce,
    ),
    sessionIdx: index('eval_scores_session_idx').on(table.sessionId),
  }),
);
```

## DBOS Workflow

```
EvalSessionWorkflow (one per session, manages both variant scores)

  1. Create session + two score slots (with_context, without_context)
     setEvent('session.created', { session_id, nonces, task_md })

  2. Wait for claims + submissions (per variant)
     Each variant goes through: started → claimed → scored
     The workflow tracks completion of both variants.

  3. When both variants are scored:
     Transition session: running → scored
     Compute context_lift = with_context.reward - without_context.reward
     setEvent('session.scored', { session_id, context_lift })

  4. Timeout: if expires_at reached before both scored → expired
```

Since the two variants run as independent Harbor tasks (possibly in parallel),
the workflow uses `recv()` to collect results as they arrive:

```typescript
// Pseudocode — actual DBOS registration pattern omitted for clarity
async function evalSessionWorkflow(input: {
  taskId: string;
  packId: string | null;
  model: string;
  judgeMode: 'local' | 'remote';
  startedBy: string;
}) {
  const session = await createSessionStep(input);

  // Wait for both variant scores (order doesn't matter)
  const remaining = new Set(['with_context', 'without_context']);

  while (remaining.size > 0) {
    const msg = await DBOS.recv<ScoreSubmission>(
      'score.submitted',
      sessionTimeoutSeconds,
    );
    if (!msg) {
      await expireSessionStep(session.id);
      return { status: 'expired' };
    }
    remaining.delete(msg.variant);
  }

  // Both scored — finalize
  const proof = await finalizeSessionStep(session.id);
  return { status: 'scored', proof };
}
```

## Harbor Integration

### run.ts changes

Before launching Harbor, the runner:
1. Authenticates via CLIENT_ID/CLIENT_SECRET → access token
2. Calls `POST /evals/sessions` → gets session_id, task_md, per-variant nonces
3. Writes task_md to both variant task dirs (overriding local copy)
4. Passes variant-specific env vars into each Harbor task:
   - `EVAL_SESSION_ID`, `EVAL_VARIANT`, `EVAL_NONCE`, `EVAL_API_URL`
   - `EVAL_CLIENT_ID`, `EVAL_CLIENT_SECRET`

### task.toml changes

```toml
[verifier.env]
# ... existing vars ...
EVAL_SESSION_ID = "${EVAL_SESSION_ID:-}"
EVAL_VARIANT = "${EVAL_VARIANT:-}"
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
    await proctoredJudge(sessionId);
  } else {
    await localJudge(); // existing behavior, unchanged
  }
}

async function proctoredJudge(sessionId: string): Promise<void> {
  const apiUrl = process.env.EVAL_API_URL!;
  const variant = process.env.EVAL_VARIANT!;
  const nonce = process.env.EVAL_NONCE!;
  const clientId = process.env.EVAL_CLIENT_ID!;
  const clientSecret = process.env.EVAL_CLIENT_SECRET!;

  // 1. Authenticate
  const token = await getAccessToken(apiUrl, clientId, clientSecret);

  // 2. Hash artifacts
  const artifactsHash = await hashDirectory('/app');

  // 3. Claim criteria from server
  const { criteria, judge_prompt, criteria_hash } = await fetch(
    `${apiUrl}/evals/sessions/${sessionId}/scores/${variant}/claim`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ nonce, artifacts_hash: artifactsHash }),
    },
  ).then((r) => r.json());

  // 4. Run LLM judge (same scoring logic as localJudge)
  const { scored, reward } = await runJudge(criteria, judge_prompt);

  // 5. Submit scores to server
  await fetch(
    `${apiUrl}/evals/sessions/${sessionId}/scores/${variant}/submit`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        nonce,
        scores: scored,
        reward,
        judge_model: process.env.JUDGE_MODEL ?? 'claude-sonnet-4-6',
        criteria_hash,
        artifacts_hash: artifactsHash,
      }),
    },
  );

  // 6. Write local reward.json too (Harbor expects it)
  await writeReward({ reward });
}
```

### scaffold.ts changes

Still generates local `criteria.json` for offline dev. The `pnpm eval:push`
command uploads to the server. Scaffold and push are independent operations.

## Upload CLI

```bash
# Upload all eval definitions to server
pnpm eval:push

# Upload specific eval
pnpm eval:push --name mcp-format-uuid-validation

# Dry-run (show what would be uploaded)
pnpm eval:push --dry-run
```

Reads from `tiles/moltnet-practices/evals/*/`, creates evals that don't
exist yet (`POST /evals`), and pushes task versions (`POST /evals/:id/tasks`).
CID-idempotent — if content hasn't changed, no new task row is created.

## API Endpoints Summary

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /evals | eval:manage | Create an eval |
| GET | /evals | eval:read | List evals (paginated, searchable) |
| GET | /evals/:id | eval:read | Get eval + latest task |
| POST | /evals/:id/tasks | eval:manage | Push a task version (CID-idempotent) |
| GET | /evals/:id/tasks | eval:read | List task versions (paginated) |
| POST | /evals/sessions | eval:run | Start session (creates 2 score slots) |
| GET | /evals/sessions/:id | eval:read | Get session status + scores |
| POST | /evals/sessions/:id/scores/:variant/claim | eval:judge | Judge claims criteria |
| POST | /evals/sessions/:id/scores/:variant/submit | eval:judge | Submit scores + ATIF |
| GET | /evals/scores | eval:read | Query scores (filterable) |

### Eval list endpoint

```
GET /evals?q=mcp&limit=20&offset=0&expand=latest_task
Auth: Bearer <agent_token>  (eval:read scope)
Response: {
  items: [
    {
      id: uuid,
      name: "mcp-format-uuid-validation",
      description: "Tests whether...",
      created_by: uuid,
      created_at: ISO8601,
      latest_task?: {            // included when expand=latest_task
        task_id: uuid,
        eval_cid: "bafy...",
        created_at: ISO8601
      },
      task_count: 3
    }
  ],
  total: 14,
  limit: 20,
  offset: 0
}
```

Query params:
- `q` — full-text search on name + description
- `created_by` — filter by agent identity
- `expand=latest_task` — include the most recent task version inline
- `limit`, `offset` — pagination (same pattern as diary entries)

## Score Query API

The main consumer: "how does my pack perform?"

```
GET /evals/scores?pack_id=xxx
Response: {
  sessions: [
    {
      session_id: uuid,
      eval_id: uuid,
      eval_name: "mcp-format-uuid-validation",   // denormalized for display
      task_id: uuid,
      eval_cid: "bafy...",
      model: "claude-sonnet-4-6",
      judge_mode: "local",
      with_context: {
        reward: 0.85,
        scores: [...],
        metadata: {
          total_prompt_tokens: 12345,
          total_completion_tokens: 6789,
          total_cost_usd: 0.42,
          total_steps: 15,
          duration_ms: 45000
        },
        proof_signature: "ed25519:..."
      },
      without_context: {
        reward: 0.60,
        scores: [...],
        metadata: { ... },
        proof_signature: "ed25519:..."
      },
      context_lift: 0.25,
      created_at: "2026-03-28T..."
    }
  ],
  summary: {
    avg_with_context: 0.82,
    avg_without_context: 0.58,
    avg_context_lift: 0.24
  }
}
```

Score query params:
- `pack_id` — scores for a specific pack
- `eval_id` — scores for a specific eval
- `task_id` — scores for a specific task version
- `model` — filter by agent model
- `limit`, `offset` — pagination

## Keto Relations

```
eval:manage  — can upload/update eval definitions
eval:run     — can start eval sessions
eval:judge   — can claim criteria and submit scores
eval:read    — can view scores and definitions
```

## Agent Telemetry

Harbor captures agent metrics in its **ATIF trajectory** (Agent Trajectory
Interchange Format). The `final_metrics` object includes:

```json
{
  "total_prompt_tokens": 12345,
  "total_completion_tokens": 6789,
  "total_cached_tokens": 1000,
  "total_cost_usd": 0.42,
  "total_steps": 15
}
```

Per-step data also includes timestamps, tool calls, and model info.

### Mounting ATIF in the verifier

The ATIF trajectory is written by Harbor's trial runner **outside** the
verifier container. By default, the verifier only sees:
- `/app/*` — agent-produced artifacts
- `/tests/*` — criteria, judge code
- `/logs/verifier/` — where it writes reward.json

**Plan:** Contribute an upstream change to Harbor (or use custom verifier
config) to mount the agent trajectory at `/logs/trajectory.json` inside the
verifier container. This lets `judge.ts` read ATIF metrics and submit them
alongside scores in one call — no separate metrics endpoint needed.

The `metadata` field in the submit payload carries the ATIF `final_metrics`:

```typescript
// In judge.ts, during proctored submission:
const trajectory = JSON.parse(
  await readFile('/logs/trajectory.json', 'utf-8'),
);
const metrics = trajectory.final_metrics;

await submitScores(apiUrl, token, sessionId, {
  // ... scores, reward, etc.
  metadata: {
    total_prompt_tokens: metrics.total_prompt_tokens,
    total_completion_tokens: metrics.total_completion_tokens,
    total_cached_tokens: metrics.total_cached_tokens,
    total_cost_usd: metrics.total_cost_usd,
    total_steps: metrics.total_steps,
    duration_ms: computeDurationFromPhases(trajectory),
  },
});
```

This is stored in `eval_scores.metadata` JSONB.

## Open Questions

1. **Spot-check frequency** — What % of local-judged submissions should the
   server re-judge for audit? Configurable per definition?

2. **Artifact storage** — Should the server store artifacts tarball, or only
   the hash? Storing artifacts enables remote re-judging but costs storage.

3. **Time windows** — Session expiry (both variants): 1 hour? Claim-to-submit
   window (per variant judge): 10 min?

4. **Partial sessions** — What if only one variant completes? Keep partial data
   but mark session as expired? Or discard?

5. **Harbor upstream** — Scope of the ATIF-in-verifier change. Could be a
   task.toml config (`[verifier] mount_trajectory = true`) or a default
   behavior change. Need to check Harbor's extension points.
