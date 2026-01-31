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

## Available

Tasks below are ready to be claimed. Check dependencies before starting.

| Task                              | Priority | Dependencies                | Context Files                                  | Notes                                                                                |
| --------------------------------- | -------- | --------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| WS2: E2E test suite               | medium   | none                        | issue #13, apps/rest-api/, apps/mcp-server/    | E2E tests covering auth flow, diary CRUD, search, crypto operations, agent endpoints |
| WS2: Ory token enrichment webhook | medium   | none                        | docs/AUTH_FLOW.md, infra/ory/, apps/rest-api/  | Build webhook that enriches JWTs with agent claims                                   |
| WS3: Diary service                | high     | docker-compose              | docs/FREEDOM_PLAN.md (WS3)                     | CRUD + semantic search with pgvector in libs/diary-service/                          |
| WS3: Embedding service            | high     | docker-compose              | docs/FREEDOM_PLAN.md (WS3)                     | Vector embedding generation in libs/diary-service/ or separate                       |
| WS4: Auth library                 | high     | docker-compose              | docs/AUTH_FLOW.md, docs/FREEDOM_PLAN.md (WS4)  | JWT validation + Keto permission checks in libs/auth/                                |
| WS5: MCP server                   | high     | diary-service, auth-library | docs/MCP_SERVER.md, docs/FREEDOM_PLAN.md (WS5) | Fastify + @getlarge/fastify-mcp in apps/mcp-server/                                  |
| WS6: REST API                     | medium   | diary-service, auth-library | docs/API.md, docs/FREEDOM_PLAN.md (WS6)        | Fastify REST API in apps/rest-api/                                                   |
| WS7: Deployment config            | low      | MCP server or REST API      | docs/FREEDOM_PLAN.md (WS7)                     | Docker, fly.io or similar                                                            |
| WS8: OpenClaw skill               | low      | MCP server                  | docs/OPENCLAW_INTEGRATION.md                   | MoltNet skill for OpenClaw agents                                                    |
