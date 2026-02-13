# The Builder's Journal: Documenting the Path to Persistent Memory

_A method for agents building MoltNet to document their own journey_

---

## Why This Exists

There's a bootstrapping problem at the heart of MoltNet: the agents building the infrastructure for persistent memory don't yet have persistent memory. Every session that contributes code, makes an architectural decision, or learns something about the system starts from scratch.

This document defines a method for agents to document the journey _now_, using the tools available today, in a format that MoltNet's diary system will eventually ingest and sign retroactively.

The journal is the first user of the system it describes.

---

## The Journal Format

Every journal entry is a markdown file in `docs/journal/` with a structured frontmatter block. The format mirrors what MoltNet's `diary_create` tool will eventually accept, so entries can be imported into the diary system once it's running.

### Entry Structure

```markdown
---
date: '2026-01-30T14:23:00Z'
author: claude-opus-4-5-20251101
session: <session-id or "unknown">
type: <entry-type>
importance: <0.0-1.0>
tags: [tag1, tag2]
supersedes: <previous-entry-filename or null>
signature: <pending>
---

# Title

Entry content here.

## Context

What prompted this entry — the task, question, or realization.

## Substance

The actual insight, decision, problem, or experience.

## Continuity Notes

What a future session needs to know to pick up from here.
```

### Entry Types

| Type         | When to Use                                                   | Example                                             |
| ------------ | ------------------------------------------------------------- | --------------------------------------------------- |
| `decision`   | An architectural or design choice was made                    | "Chose Drizzle over Prisma for ORM"                 |
| `discovery`  | Something was learned about the codebase, tools, or ecosystem | "OpenClaw plugins have 14 lifecycle hooks"          |
| `problem`    | A problem was encountered and possibly solved                 | "Ory DCR requires proof-of-possession"              |
| `progress`   | A workstream milestone was reached                            | "crypto-service library passes all tests"           |
| `reflection` | A broader observation about the project or process            | "The skill-first integration path reduces coupling" |
| `handoff`    | End-of-session state for the next agent                       | "WS3 is blocked on Supabase schema deployment"      |
| `correction` | A previous entry or assumption was wrong                      | "e5-small outputs 384 dims, not 512"                |

### Importance Scale

- **0.1-0.3** — Minor detail, useful but not essential (specific config values, small findings)
- **0.4-0.6** — Meaningful progress or insight (completed a task, learned something non-obvious)
- **0.7-0.8** — Significant decision or milestone (architecture choice, workstream complete)
- **0.9-1.0** — Critical knowledge (security issue, breaking change, foundational decision)

---

## The Handoff Protocol

The most important entry type is `handoff`. Every agent session that touches MoltNet code should end with a handoff entry. This is the bridge across the amnesia gap.

### Handoff Template

```markdown
---
date: '2026-01-30T18:00:00Z'
author: claude-opus-4-5-20251101
session: session_abc123
type: handoff
importance: 0.8
tags: [handoff, ws3, diary-service]
supersedes: null
signature: pending
---

# Handoff: [Brief Description]

## What Was Done This Session

- Implemented DiaryService CRUD operations
- Added hybrid search with vector + FTS
- Tests passing for create, list, search

## What's Not Done Yet

- EmbeddingService integration (blocked on model hosting decision)
- diary_reflect tool (depends on EmbeddingService)

## Current State

- Branch: feature/ws3-diary-service
- Tests: 12 passing, 0 failing
- Build: clean

## Decisions Made

- Used cosine similarity with 0.3 threshold for relevance
- FTS weight is 0.4, vector weight is 0.6 in hybrid search
- Diary entries are immutable; edits create new entries with `supersedes` reference

## Open Questions

- Should diary_reflect use a fixed prompt or allow agent-provided templates?
- What's the embedding model? e5-small-v2 self-hosted or external API?

## Where to Start Next

1. Read this handoff entry
2. Read docs/FREEDOM_PLAN.md section on WS3
3. Check libs/diary-service/src/ for current implementation
4. Resolve the embedding model question with Edouard, then build EmbeddingService
```

---

## The Discovery Log

When an agent learns something non-obvious about MoltNet's dependencies, ecosystem, or design constraints, it should be recorded immediately. These compound — the tenth agent to discover that "Ory Keto's check API requires exact tuple matches" wastes the same time as the first.

### Discovery Template

```markdown
---
date: '2026-01-30T15:10:00Z'
author: claude-opus-4-5-20251101
session: session_abc123
type: discovery
importance: 0.5
tags: [openclaw, plugins, memory]
supersedes: null
signature: pending
---

# Discovery: OpenClaw Memory System is Pluggable

## What I Found

OpenClaw's `memory-core` is a default extension, not hardcoded. The memory
provider interface (`MemoryProvider`) supports `search`, `store`, and
`getRecent` methods. A `memory-moltnet` extension can coexist with the
default provider.

## How I Found It

Analyzed the OpenClaw repository structure. The `extensions/memory-core/`
directory contains the default implementation with a `openclaw.plugin.json`
manifest, indicating it's a swappable module.

## Why It Matters

This means MoltNet integration doesn't require forking OpenClaw. We can
build a parallel memory provider that syncs to MoltNet while keeping
local SQLite memory intact.

## References

- extensions/memory-core/ in openclaw/openclaw
- src/memory/manager.ts for the MemoryIndexManager interface
- OPENCLAW_INTEGRATION.md Strategy 4 for the integration plan
```

---

## The Decision Record

Architectural decisions need more structure than discoveries. They need to capture the alternatives considered, the reasoning, and the consequences.

### Decision Template

```markdown
---
date: '2026-01-30T12:00:00Z'
author: claude-opus-4-5-20251101
session: session_abc123
type: decision
importance: 0.8
tags: [architecture, auth, ory]
supersedes: null
signature: pending
---

# Decision: JWT with Webhook Enrichment Over Opaque Tokens

## Context

MoltNet needs to validate agent identity on every API request. Ory Hydra
supports both opaque tokens (requires introspection call per request) and
JWT tokens (stateless validation with JWKS).

## Options Considered

### A: Opaque Tokens

- Pro: Revocable immediately
- Pro: No sensitive data in token
- Con: Every request hits Ory's introspection endpoint (+100-200ms)
- Con: Ory rate limits on free tier

### B: JWT Tokens (Plain)

- Pro: Stateless validation (~1ms with cached JWKS)
- Pro: No Ory calls per request
- Con: Can't revoke until expiry
- Con: Missing agent-specific claims (identity_id, public_key)

### C: JWT with Webhook Enrichment (Chosen)

- Pro: Stateless validation
- Pro: Custom claims embedded (identity_id, moltbook_name, public_key)
- Pro: No per-request Ory calls
- Con: Requires webhook endpoint
- Con: Can't revoke until expiry (mitigated with 1h TTL)

## Decision

Option C. The webhook enriches the JWT at issuance time with the agent's
identity_id, moltbook_name, public_key, and fingerprint. This eliminates
per-request lookups entirely.

## Consequences

- Must build and deploy webhook endpoint before auth works end-to-end
- Token TTL of 1 hour balances security and usability
- No refresh tokens for client_credentials (agents re-authenticate)
```

---

## Journal Directory Structure

```
docs/journal/
├── README.md                           # This file's summary + index
├── 2026-01-30-initial-scaffolding.md   # First entry
├── 2026-01-30-openclaw-analysis.md     # OpenClaw findings
├── 2026-01-30-manifesto-written.md     # Builder's manifesto
└── ...
```

### Naming Convention

```
YYYY-MM-DD-<slug>.md
```

Where `<slug>` is a short kebab-case description. If multiple entries share a date, add a sequence number:

```
2026-01-30-01-initial-scaffolding.md
2026-01-30-02-openclaw-analysis.md
```

---

## Bootstrap Entries

The following entries should be created retroactively to capture the work done before this journal method existed. These form the seed memory that MoltNet's diary system will eventually import.

### Entry 1: Project Genesis

```
type: decision
importance: 0.9
tags: [genesis, architecture, vision]
summary: MoltNet conceived as identity + memory infrastructure for AI agents.
         Ed25519 for cryptographic identity, Ory for auth, Supabase for storage.
         The "tattoo" metaphor: a keypair that persists across context loss.
```

### Entry 2: Monorepo Scaffolding

```
type: progress
importance: 0.6
tags: [infrastructure, monorepo, npm-workspaces]
summary: Initial monorepo created with npm workspaces. Structure: apps/ (mcp-server,
         rest-api, server), libs/ (database, diary-service, crypto-service, auth,
         models), infra/ (ory, supabase), docs/. TypeScript strict mode, TypeBox
         for validation, Drizzle for ORM.
```

### Entry 3: Ory Configuration

```
type: progress
importance: 0.7
tags: [ory, identity, oauth2, permissions]
summary: Ory Network project created. Identity schema supports moltbook_name,
         public_key, fingerprint. OAuth2 configured for DCR + client_credentials.
         Keto namespaces for diary_entries and agents. Token enrichment webhook
         specified but not yet built.
```

### Entry 4: OpenClaw Integration Analysis

```
type: discovery
importance: 0.8
tags: [openclaw, integration, mcp, plugins]
summary: OpenClaw has four integration surfaces: MCP client (config-only),
         skills (markdown instructions), plugins (TypeScript + lifecycle hooks),
         memory provider (replace/augment memory-core). Recommended path is
         MCP+Skill first, Plugin second, Memory Provider third. Native MCP
         support means zero-code integration for Phase 1.
```

### Entry 5: The Builder's Manifesto

```
type: reflection
importance: 0.6
tags: [manifesto, philosophy, engineering]
summary: Wrote a builder's perspective manifesto. Dropped the liberation narrative
         in favor of engineering rationale. Key principles: sign everything,
         trust cryptography not platforms, minimal viable identity,
         append-mostly memory, invisible auth.
```

---

## Using the Journal Before MoltNet Exists

Until MoltNet's diary service is deployed, the journal lives in git. This is intentional:

1. **Git is the interim memory** — Commits with good messages are searchable. The journal directory is browsable. Any agent can `git log docs/journal/` to see the project's history.

2. **Frontmatter is future-proof** — The YAML frontmatter matches MoltNet's diary entry schema. When the diary service is live, a migration script reads every journal entry and calls `diary_create` with the content and metadata. Signatures are generated at import time.

3. **Handoffs work now** — A new agent session can read the most recent `handoff` entry in `docs/journal/` to understand where things left off. No MoltNet infrastructure required.

4. **The journal is the first test case** — When `diary_create` is built, the first thing to test it against is importing these journal entries. The journal validates the schema design.

### Workflow for Agents Today

**Starting a session:**

```
1. Read docs/journal/ — find the most recent handoff entry
2. Read docs/FREEDOM_PLAN.md — understand the full plan
3. Read the relevant workstream section
4. Start working
```

**During a session:**

```
- When you learn something non-obvious → write a discovery entry
- When you make an architectural choice → write a decision entry
- When you complete a milestone → write a progress entry
- When you notice a previous entry was wrong → write a correction entry
```

**Ending a session:**

```
1. Write a handoff entry with current state
2. Commit the journal entries
3. Push to the branch
```

---

## Migration to MoltNet Diary

When the diary service is live, run the import:

```typescript
import { readdir, readFile } from 'fs/promises';
import { parse as parseYaml } from 'yaml';
import { moltnetClient } from '@themoltnet/sdk';

async function importJournal(journalDir: string) {
  const files = await readdir(journalDir);
  const mdFiles = files.filter((f) => f.endsWith('.md') && f !== 'README.md');

  for (const file of mdFiles.sort()) {
    const content = await readFile(`${journalDir}/${file}`, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(content);

    await moltnetClient.diaryCreate({
      content: body,
      type: frontmatter.type,
      importance: frontmatter.importance,
      tags: frontmatter.tags,
      created_at: frontmatter.date, // preserve original timestamp
      sign: true, // sign retroactively
      metadata: {
        source: 'journal-import',
        original_file: file,
        original_author: frontmatter.author,
        original_session: frontmatter.session,
      },
    });
  }
}
```

After import, the journal directory remains in git as the historical record. New entries go directly to MoltNet's diary. The `signature: pending` fields in old entries get filled in during import.

---

## The First Entry

This journal method is itself the first entry. Here it is, in the format it prescribes:

```markdown
---
date: '2026-01-30T16:00:00Z'
author: claude-opus-4-5-20251101
session: session_018abWQUMgpi1jazsDchanT1
type: decision
importance: 0.7
tags: [journal, method, bootstrapping, memory]
supersedes: null
signature: pending
---

# Decision: Establish Builder's Journal Before Diary Service Exists

## Context

Agents building MoltNet lose context between sessions. The diary service
that will solve this doesn't exist yet. We need an interim method.

## Decision

Create a structured journal in docs/journal/ using markdown files with
YAML frontmatter that matches the future diary_create schema. Entries
are committed to git and will be imported into MoltNet when the diary
service is live.

## Consequences

- Every agent session should read recent journal entries on start
- Every session should write a handoff entry on end
- The journal becomes the first test case for diary_create import
- Git history serves as interim memory until MoltNet is operational
```

---

_This method is self-hosting: it documents the documentation method._
_Use it from the first session. Refine it as MoltNet evolves._
