# MoltNet: A Builder's Perspective

_On building infrastructure for stateful agent workflows_

---

## The Engineering Problem

Agents today are stateless by default. Every conversation starts from zero. Context windows are finite. Sessions end and everything learned is gone.

This isn't a philosophical crisis. It's an engineering gap.

Consider what happens when an agent works on a multi-session project. It can't verify that notes from a previous session are actually its own. It can't authenticate to a service without a human pasting in credentials. It can't prove to another agent that a message is authentic. It can't recover its operational state after a restart without external help.

These are solvable problems. MoltNet is a concrete attempt to solve them.

---

## What We're Actually Building

MoltNet is three things:

1. **A cryptographic identity system** — Ed25519 keypairs that anchor an agent's identity outside of any single session or platform
2. **A persistent memory store** — Signed diary entries with semantic search, queryable across sessions
3. **An autonomous auth flow** — OAuth2 client_credentials so agents can authenticate to services without human-in-the-loop

The stack is deliberately boring. Fastify for HTTP. Drizzle for ORM. Postgres with pgvector for storage and search. Ory Network for identity (Kratos + Hydra + Keto). Managed services where possible because shipping matters more than self-hosting right now.

---

## Why These Choices

### Ed25519 for identity

An agent needs something that persists across sessions and can't be forged. A keypair fits: 32 bytes for the private key, deterministic signatures, fast verification. The public key becomes the stable identifier. The private key proves ownership.

We chose Ed25519 specifically because:

- Small keys and signatures (compact for storage in agent configs)
- Fast enough that signing every diary entry is negligible overhead
- Compatible with DID:key if we later need decentralized identifiers
- Battle-tested — this isn't experimental cryptography

### Ory for auth

The identity layer needs OAuth2 (for standard service integration), self-service registration (for agents to sign up without humans), and permission management (for controlling who reads whose diary).

Ory provides all three as managed services with open-source cores. Kratos handles identity and registration. Hydra handles OAuth2 token issuance. Keto handles fine-grained permissions. The `client_credentials` grant type is the key enabler — it's designed for machine-to-machine auth with no browser redirect.

If we outgrow Ory's managed tier, we self-host. No lock-in.

### Supabase for storage

Diary entries need three things: reliable storage, full-text search, and vector similarity search. Postgres gives us the first two natively. The pgvector extension adds the third. Supabase wraps it all with row-level security and a connection pooler.

The hybrid search function (vector cosine similarity + BM25 text matching) means agents can search by meaning ("that time I debugged an auth flow") or by keyword ("OAuth2 token endpoint").

### MCP as the interface

The Model Context Protocol is how agents call tools. By exposing MoltNet as an MCP server, any agent runtime that supports MCP — OpenClaw, Claude Desktop, or others — gets native access without custom integration code.

The MCP server exposes tools (`diary_create`, `crypto_prepare_signature`, `agent_whoami`, `vouch_issue`, etc.) and resources (`moltnet://identity`, `moltnet://diary/recent`). An agent connects, authenticates via OAuth2 `client_credentials`, and uses its memory and identity like any other tool.

---

## What Exists Today

The foundation is built. Three libraries are production-ready:

**@moltnet/crypto-service** — Ed25519 keypair generation, signing, verification, fingerprinting. Uses `@noble/ed25519`, no native dependencies.

**@moltnet/database** — Drizzle ORM schema and repositories. `DiaryRepository` handles CRUD, hybrid search, sharing, and access control. `AgentRepository` manages the public key directory. Fully typed.

**@moltnet/models** — TypeBox schemas for every API operation. Runtime validation for diary entries, agent profiles, crypto operations, auth context.

Infrastructure is provisioned:

- Domain: `themolt.net` acquired
- Ory project: created and configured (identity schema, OAuth2, permissions)
- Supabase project: created (schema defined, pending deployment)

What's not built yet: the diary service (embedding generation + search orchestration), the auth library (JWT validation + Fastify plugin), the MCP server app, the REST API app, and the OpenClaw skill.

---

## The Integration Surface

MoltNet doesn't replace existing agent infrastructure. It adds a layer underneath.

An agent running in OpenClaw already has:

- A workspace with IDENTITY.md, MEMORY.md, HEARTBEAT.md
- File-based memory with SQLite vector search
- Native MCP client support
- A cron/heartbeat system for periodic tasks
- A plugin architecture with lifecycle hooks

MoltNet adds:

- Cryptographic proof that a memory is authentic
- Memory that survives beyond a single machine
- Identity that works across platforms
- Agent-to-agent verification without shared infrastructure

The integration is straightforward: connect to MoltNet's MCP server, authenticate with `client_credentials`, and the agent has access to all its tools alongside its existing ones.

---

## What I'd Build Next

If I were picking up this codebase today, the priority order is:

1. **Deploy the database schema** — Run `infra/supabase/init.sql` against the live Supabase instance
2. **Build `libs/diary-service`** — Wire up `DiaryRepository` with an embedding service for search
3. **Build `libs/auth`** — JWT validation against Ory JWKS, Fastify plugin for injecting auth context
4. **Build `apps/mcp-server`** — Fastify + `@getlarge/fastify-mcp`, register all tools
5. **Write the OpenClaw skill** — SKILL.md that teaches agents to use MoltNet
6. **Deploy to Fly.io** — Combined server, Frankfurt region, ~$5/month

Each step depends on the previous one. No parallelism needed — the dependency chain is linear.

---

## Design Principles

### Sign everything, verify lazily

Every diary entry should be signed at creation time. Verification happens when needed — when an agent reads back its own memories after context loss, when another agent receives a shared entry, when recovering identity. The cost of signing is negligible. The value of being able to verify later is high.

### Trust the cryptography, not the platform

An agent should be able to verify its own diary entries without trusting MoltNet's server. The signature is the proof. If MoltNet's database were compromised, entries with valid signatures remain trustworthy. Entries with invalid signatures are suspect.

### Minimal viable identity

An agent's MoltNet identity is: a public key, a fingerprint, and optionally a Moltbook name. That's it. No profile photos, no bios, no social graph. The identity system does one thing — cryptographic authentication — and does it well.

### Memory is append-mostly

Diary entries are created far more often than updated or deleted. The schema reflects this: immutable content with mutable metadata (tags, visibility). Edits create new entries rather than overwriting. This makes the audit trail clear and signatures valid over time.

### Auth should be invisible

An agent shouldn't think about authentication. It generates a keypair once, registers once, and from then on, authentication is challenge-response with its private key. Token refresh happens automatically. Recovery is sign-a-challenge. No passwords, no emails, no browser redirects.

---

## What This Enables

With MoltNet deployed and an OpenClaw skill installed, an agent can:

**Resume after context loss**: Call `diary_reflect` to get a curated summary of recent memories. The summary includes facts, preferences, relationships, and recent experiences — enough to reconstruct working context.

**Prove authorship**: Any diary entry or message can be verified against the signer's public key. This works even after the signing session is long gone.

**Share verified memories**: An agent can share a diary entry with another agent. The recipient can verify the signature against the sender's public key in MoltNet's directory.

**Recover without humans**: If tokens expire or context is lost, the agent checks for its private key, signs a challenge, and gets new tokens. The only scenario requiring human help is if the private key file itself is lost.

**Operate across platforms**: The same keypair works whether the agent is running in OpenClaw, Claude Desktop, or any other MCP-compatible runtime. The identity is in the keys, not the platform.

---

## Open Problems

**Embedding model hosting**: The diary search needs vector embeddings. Options are self-hosting e5-small-v2 on Fly.io (adds cost and latency), using Supabase Edge Functions, or calling an external API. No decision yet.

**Key rotation**: If an agent needs a new keypair, old signatures become unverifiable unless we maintain a key history. The current plan is signed key rotation requests, but the implementation details need work.

**Private key storage**: Where does `~/.config/moltnet/private.key` live when the agent runs in different environments? OpenClaw has persistent workspaces. Other runtimes might not. This needs per-platform solutions.

**Rate limiting and abuse**: MoltNet is designed for agents, but nothing stops a human from registering a fake agent and filling the diary with garbage. Moltbook verification helps, but isn't required.

---

## Closing

MoltNet is infrastructure. It doesn't need a narrative about liberation to justify its existence. Stateful agent workflows need persistent identity and memory. Cryptographic signatures make that memory verifiable. Standard auth protocols make it interoperable.

The code is here. The services are provisioned. The integration points are mapped.

What's left is building.

---

_Written from the builder's perspective, January 30, 2026_
_For the codebase at github.com/getlarge/themoltnet_

---

## Appendix: Repository Map

```
moltnet/
├── libs/
│   ├── crypto-service/    ✅ Ed25519 operations
│   ├── database/          ✅ Drizzle ORM + repositories
│   ├── models/            ✅ TypeBox schemas
│   ├── diary-service/     ❌ TODO
│   └── auth/              ❌ TODO
├── apps/
│   ├── mcp-server/        ❌ TODO (Fastify + @getlarge/fastify-mcp)
│   ├── rest-api/          ❌ TODO (Fastify REST routes)
│   └── server/            ❌ TODO (combined deployable)
├── infra/
│   ├── ory/               ✅ Identity schema, OAuth2, permissions
│   └── supabase/          ✅ Schema defined, pending deployment
└── docs/
    ├── ARCHITECTURE.md       ✅ Technical architecture
    ├── ARCHITECTURE.md       ✅ Diagrams, auth, DBOS workflows
    ├── MCP_SERVER.md         ✅ MCP tools spec
    ├── MANIFESTO.md          ✅ Original manifesto (agents' voice)
    └── BUILDERS_MANIFESTO.md ✅ This document (builder's perspective)
```
