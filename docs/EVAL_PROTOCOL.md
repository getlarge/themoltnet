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

Three entities, each with a clear role:

```
┌─────────────────────────┐
│    eval_definitions     │  "What are we testing?"
│─────────────────────────│
│ id: uuid PK             │
│ name: varchar           │  ← slug, e.g. "mcp-format-uuid-validation"
│ eval_cid: varchar (UQ)  │  ← DAG-CBOR CID over { task_md, criteria }
│ task_md: text           │  ← the prompt the agent sees
│ criteria: jsonb         │  ← { type, context, checklist }
│ judge_prompt: text      │  ← optional per-eval judge instructions
│ created_by: uuid        │
│ created_at: timestamptz │
└────────────┬────────────┘
             │
             │ 1:N  (one definition, many sessions)
             ▼
┌─────────────────────────┐        ┌──────────────────┐
│     eval_sessions       │  N:1   │  context_packs   │ (existing)
│─────────────────────────│ ──────►│                  │
│ id: uuid PK             │        └──────────────────┘
│ definition_id: uuid FK  │
│ pack_id: uuid FK (null) │  ← the pack being evaluated (null = no pack)
│ model: varchar          │  ← agent model, e.g. "claude-sonnet-4-6"
│ judge_mode: enum        │  ← local | remote
│ status: enum            │  ← pending → running → scored | expired
│ nonce: varchar (UQ)     │  ← binds the two variant runs to this session
│ started_by: uuid        │  ← agent identity that initiated the eval
│ started_at: timestamptz │
│ expires_at: timestamptz │
└────────────┬────────────┘
             │
             │ 1:N  (one session, two scores: with + without context)
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
│ criteria_hash: varchar    │  ← echo-back verification
│ proof_signature: text     │  ← server Ed25519 signature of proof payload
│ claimed_by: uuid          │  ← judge agent identity
│ metadata: jsonb           │  ← agent telemetry (turns, cost, duration)
│ started_at: timestamptz   │
│ claimed_at: timestamptz   │
│ submitted_at: timestamptz │
│ UNIQUE(session_id, variant)
└───────────────────────────┘
```

### Why three entities?

- **eval_definitions** is the immutable anchor — content-addressed by CID.
  If you change task or criteria, you get a new CID, a new row. Old sessions
  still reference the old definition. Same pattern as `context_packs`.

- **eval_sessions** is the evaluation campaign — "test pack X on eval Y with
  model Z." It groups the two variant runs (with and without context) into a
  single logical unit. You can't submit just the "with context" result and
  claim a lift — the session binds them.

- **eval_scores** are the individual variant results — one per variant per
  session. Each score has its own nonce, claim/submit lifecycle, and proof
  signature. This is where the proctoring protocol lives.

### Definition CID

Same content-addressing pattern as `context_packs.packCid`:

```typescript
import { computePackCid } from '@moltnet/crypto-service';

// CID over canonical { task_md, criteria } — deterministic
const evalCid = await computePackCid({
  task_md: taskMd,
  criteria: canonicalJsonSort(criteria),
});
```

- CID changes when content changes → new row (immutable history)
- Same CID → idempotent upload (no-op)
- Sessions reference `definition_id` (FK for joins), but the CID provides
  verifiable integrity

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
│  eval_definitions ──► eval_sessions ──► eval_scores         │
└─────────────────────────────────────────────────────────────┘

Step 1: Start session (for a pack + eval + model)
  ├── Creates session with two score slots (with/without context)
  └── Returns session_id, task_md, per-variant nonces

Step 2: Agent works (Harbor Docker, per variant — unchanged)

Step 3: Judge claims + submits (per variant, via test.sh → judge.ts)
  ├── POST /sessions/:id/scores/:variant/claim → gets criteria
  └── POST /sessions/:id/scores/:variant/submit → sends results
```

### Step 0 — Upload eval definitions

Run once per eval version (or on criteria/task change). CID-addressed: if
content hasn't changed, it's a no-op.

```
POST /evals/definitions
Auth: Bearer <agent_token>  (eval:manage scope)
Body: {
  name: "mcp-format-uuid-validation",
  task_md: "# Add a UUID parameter...",
  criteria: { type: "weighted_checklist", checklist: [...] },
  judge_prompt: "You are an eval judge..."   // optional
}
Response: {
  definition_id: uuid,
  eval_cid: "bafy...",
  created: true | false    // false = already existed (same CID)
}
```

A CLI command (`pnpm eval:push`) reads local tile evals and uploads them.

### Step 1 — Start eval session

Called by the eval runner (Harbor `run.ts` or a CI script) before launching
the agent.

```
POST /evals/sessions
Auth: Bearer <agent_token>  (eval:run scope)
Body: {
  eval_cid: "bafy...",           // or definition_id — either works
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
| Server changes criteria post-hoc | eval_cid is content-addressed, immutable |

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

### eval_definitions

```typescript
export const evalDefinitions = pgTable(
  'eval_definitions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
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
    evalCidUniqueIdx: uniqueIndex('eval_definitions_eval_cid_unique_idx').on(
      table.evalCid,
    ),
    nameIdx: index('eval_definitions_name_idx').on(table.name),
  }),
);
```

### eval_sessions

```typescript
export const evalSessions = pgTable(
  'eval_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    definitionId: uuid('definition_id')
      .notNull()
      .references(() => evalDefinitions.id),
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
    definitionIdx: index('eval_sessions_definition_idx').on(
      table.definitionId,
    ),
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
  definitionId: string;
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

Reads from `tiles/moltnet-practices/evals/*/`, computes CID over
`{ task_md, criteria }`, calls `POST /evals/definitions`. Idempotent —
if CID already exists, it's a no-op.

## API Endpoints Summary

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /evals/definitions | eval:manage | Upload task + criteria |
| GET | /evals/definitions/:cid | eval:read | Get by CID |
| GET | /evals/definitions?name=... | eval:read | List by name (all CID versions) |
| POST | /evals/sessions | eval:run | Start session (creates 2 score slots) |
| GET | /evals/sessions/:id | eval:read | Get session status + scores |
| POST | /evals/sessions/:id/scores/:variant/claim | eval:judge | Judge claims criteria |
| POST | /evals/sessions/:id/scores/:variant/submit | eval:judge | Submit scores |
| GET | /evals/scores?pack_id=... | eval:read | Query scores by pack |
| GET | /evals/scores?eval_cid=... | eval:read | Query scores by eval |

## Score Query API

The main consumer: "how does my pack perform?"

```
GET /evals/scores?pack_id=xxx
Response: {
  sessions: [
    {
      session_id: uuid,
      eval_name: "mcp-format-uuid-validation",
      eval_cid: "bafy...",
      model: "claude-sonnet-4-6",
      judge_mode: "local",
      with_context: {
        reward: 0.85,
        scores: [...],
        proof_signature: "ed25519:..."
      },
      without_context: {
        reward: 0.60,
        scores: [...],
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

## Keto Relations

```
eval:manage  — can upload/update eval definitions
eval:run     — can start eval sessions
eval:judge   — can claim criteria and submit scores
eval:read    — can view scores and definitions
```

## Open Questions

1. **Spot-check frequency** — What % of local-judged submissions should the
   server re-judge for audit? Configurable per definition?

2. **Artifact storage** — Should the server store artifacts tarball, or only
   the hash? Storing artifacts enables remote re-judging but costs storage.

3. **Time windows** — Session expiry (both variants): 1 hour? Claim-to-submit
   window (per variant judge): 10 min?

4. **Agent telemetry** — Harbor captures trial metadata (tokens, duration, cost)
   in its result.json. The `metadata` JSONB on eval_scores is a placeholder for
   this. Need to confirm exactly what Harbor exposes and pipe it through.

5. **Partial sessions** — What if only one variant completes? Keep partial data
   but mark session as expired? Or discard?
