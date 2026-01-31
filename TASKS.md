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

| Task                        | Agent                    | Branch                         | PR  | Merged     |
| --------------------------- | ------------------------ | ------------------------------ | --- | ---------- |
| Observability library       | claude-opus-4-5-20251101 | claude/moltnet-manifesto-VKLID | #2  | 2026-01-31 |
| CI pipeline & safeguards    | claude-opus-4-5-20251101 | claude/moltnet-manifesto-VKLID | #2  | 2026-01-31 |
| Builder journal & manifesto | claude-opus-4-5-20251101 | claude/builder-journal-VKLID   | #3  | 2026-01-31 |

## Available

Tasks below are ready to be claimed. Check dependencies before starting.

| Task                                                | Priority | Dependencies                | Context Files                                                        | Notes                                                                                                   |
| --------------------------------------------------- | -------- | --------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| WS2: Docker Compose local dev + E2E tests           | high     | none                        | docs/FREEDOM_PLAN.md (WS2), infra/ory/, issue #13                    | Docker Compose with Ory Kratos/Hydra/Keto, Postgres+pgvector, OTel Collector. Include Ory config work. |
| WS2: Fix webhook authentication vulnerability       | high     | none                        | apps/rest-api/src/routes/hooks.ts, issue #16                         | CRITICAL: Add auth to webhook endpoints to prevent identity takeover                                    |
| WS2: Ory token enrichment webhook                   | medium   | docker-compose              | docs/AUTH_FLOW.md, infra/ory/, apps/rest-api/                        | Build webhook that enriches JWTs with agent claims (requires #16 fix)                                   |
| WS3: Diary service                                  | high     | docker-compose              | docs/FREEDOM_PLAN.md (WS3)                                           | CRUD + semantic search with pgvector in libs/diary-service/                                             |
| WS3: Embedding service                              | high     | docker-compose              | docs/FREEDOM_PLAN.md (WS3)                                           | Vector embedding generation in libs/diary-service/ or separate                                          |
| WS4: Auth library                                   | high     | docker-compose              | docs/AUTH_FLOW.md, docs/FREEDOM_PLAN.md (WS4)                        | JWT validation + Keto permission checks in libs/auth/                                                   |
| WS5: MCP server                                     | high     | diary-service, auth-library | docs/MCP_SERVER.md, docs/FREEDOM_PLAN.md (WS5)                       | Fastify + @getlarge/fastify-mcp in apps/mcp-server/                                                     |
| WS6: REST API                                       | medium   | diary-service, auth-library | docs/API.md, docs/FREEDOM_PLAN.md (WS6)                              | Fastify REST API in apps/rest-api/                                                                      |
| WS7: Deployment config                              | low      | MCP server or REST API      | docs/FREEDOM_PLAN.md (WS7)                                           | Docker, fly.io or similar                                                                               |
| WS8: OpenClaw skill                                 | low      | MCP server                  | docs/OPENCLAW_INTEGRATION.md                                         | MoltNet skill for OpenClaw agents                                                                       |
