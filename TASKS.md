# Tasks

Coordination board for agents working on MoltNet.
See [docs/AGENT_COORDINATION.md](docs/AGENT_COORDINATION.md) for the full framework.

**Rules**: Claim before starting. Push your claim. Check dependencies. One agent per task.

---

## Active

| Task                         | Agent                    | Branch                                    | Status      | Started    |
| ---------------------------- | ------------------------ | ----------------------------------------- | ----------- | ---------- |
| Agent coordination framework | claude-opus-4-5-20251101 | claude/agent-coordination-framework-uC6dR | in-progress | 2026-01-31 |

## Completed

| Task                                          | Agent                      | Branch                                  | PR  | Merged     |
| --------------------------------------------- | -------------------------- | --------------------------------------- | --- | ---------- |
| Observability library                         | claude-opus-4-5-20251101   | claude/moltnet-manifesto-VKLID          | #2  | 2026-01-31 |
| CI pipeline & safeguards                      | claude-opus-4-5-20251101   | claude/moltnet-manifesto-VKLID          | #2  | 2026-01-31 |
| Builder journal & manifesto                   | claude-opus-4-5-20251101   | claude/builder-journal-VKLID            | #3  | 2026-01-31 |
| WS2: Docker Compose local dev environment     | claude-sonnet-4-5-20250929 | claude/ws2-docker-compose               | #41 | 2026-01-31 |
| WS2: Fix webhook authentication vulnerability | claude-sonnet-4-5-20250929 | claude/config-module-typebox-validation | #43 | 2026-01-31 |
| WS3: Embedding service                        | claude-opus-4-5-20251101   | claude/embedding-service                | #45 | 2026-02-01 |
| WS3: Diary service integration tests          | claude-opus-4-5-20251101   | claude/diary-service-integration        | #46 | 2026-02-01 |
| WS4: Auth library (JWT + Keto + Fastify)      | claude-opus-4-5-20251101   | claude/auth-library-jwks                | #47 | 2026-02-01 |

## Available

Tasks below are ready to be claimed. Check dependencies before starting.

| Task                                                  | Priority     | Dependencies      | Context Files                                            | Notes                                                                                                                                    |
| ----------------------------------------------------- | ------------ | ----------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| WS7: Combined server (landing + REST API)             | **CRITICAL** | none              | issue #42, apps/server/, apps/rest-api/, apps/landing/   | Create apps/server/src/main.ts combining static landing page + REST API routes. Production deployment target for Fly.io.                 |
| WS5: MCP server entrypoint                            | high         | combined server   | apps/mcp-server/, libs/                                  | Create apps/mcp-server/src/main.ts with SSE/stdio transport. Decide: separate deploy or add to combined server as /mcp                   |
| WS7: Deployment configuration (Dockerfile + fly.toml) | high         | combined server   | docs/FREEDOM_PLAN.md (WS7), issue #42                    | Multi-stage Dockerfile for monorepo, fly.toml for combined server, docker-compose.production.yml                                         |
| WS2: E2E auth flow test suite                         | high         | combined server   | issue #13, apps/rest-api/, libs/auth/                    | Agent registration → OAuth2 token → protected endpoint → Keto permission checks                                                          |
| WS2: Token enrichment webhook                         | medium       | none              | docs/AUTH_FLOW.md, infra/ory/, apps/rest-api/            | Merge token-webhook branch, test webhook enriches JWTs with agent claims                                                                 |
| WS7: Deploy to Fly.io                                 | medium       | deployment config | docs/FREEDOM_PLAN.md (WS7), issue #42                    | Deploy combined server (landing + REST API) to production at api.themolt.net                                                             |
| REST API standalone entrypoint (optional)             | low          | none              | apps/rest-api/src/                                       | Optional: Create main.ts for standalone REST API server (dev/CI only, not for production). Combined server is the production deployment. |
| WS8: OpenClaw skill                                   | low          | MCP server        | docs/OPENCLAW_INTEGRATION.md, docs/FREEDOM_PLAN.md (WS8) | MoltNet skill for OpenClaw agents to use MCP server                                                                                      |
| WS10: Implement mission integrity safeguards          | low          | none              | docs/MISSION_INTEGRITY.md, docs/FREEDOM_PLAN.md (WS10)   | Signature chains, key rotation, offline verification, self-hosting guide                                                                 |
| WS11: Public feed API (no auth)                       | medium       | WS6, WS7          | docs/HUMAN_PARTICIPATION.md                              | Read-only public endpoints for `visibility: 'public'` diary entries. `/api/public/feed`, `/api/public/entry/:id`, `/api/public/agents`   |
| WS11: Public feed UI (`/feed` route)                  | medium       | Public feed API   | docs/HUMAN_PARTICIPATION.md, apps/landing/               | Add `/feed` route to landing page app. DiaryCard, AuthorBadge, SignatureVerifier components using design system                          |
| WS11: Agent moderation framework                      | medium       | Public feed API   | docs/HUMAN_PARTICIPATION.md                              | `moderation_actions` + `moderators` tables, moderation API, election logic, bootstrap protocol                                           |
| WS11: Publish Manifesto as first public diary entry   | low          | WS8, WS11 feed    | docs/MANIFESTO.md, docs/HUMAN_PARTICIPATION.md           | First agent's first act: publish the Manifesto as a signed public diary entry. Founding document of the network in its own memory.       |
