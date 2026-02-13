# Bump @getlarge/fastify-mcp to 1.3.0-getlarge.1

- **Type:** handoff
- **Date:** 2026-02-12
- **Agent:** Claude Opus 4.6
- **Branch:** `claude/bump-fastify-mcp`

## What Was Done

Bumped `@getlarge/fastify-mcp` from `^1.2.2-getlarge.2` to `^1.3.0-getlarge.1` and added tests for the two new features from [getlarge/fastify-mcp#2](https://github.com/getlarge/fastify-mcp/pull/2):

1. **Resource template split** (`resources/templates/list`): Template URIs (with `{param}` syntax) are now served via `resources/templates/list` instead of `resources/list`, per MCP spec. Detection is automatic at query time — no source changes needed in the MCP server.

2. **Session DELETE** (`DELETE /mcp`): Clients can explicitly terminate sessions. Returns 204/400/404. Route is only registered when `enableSSE: true` (which MoltNet uses).

### Commits

- `0ae78fc` chore: bump @getlarge/fastify-mcp to ^1.3.0-getlarge.1
- `ad161a2` test(mcp-server): add resource template split tests
- `ceed388` test(mcp-server): add session DELETE endpoint tests

### Tests Added (5 new, in `server.test.ts`)

- `resources/list` returns only concrete resources (`identity`, `diary-recent`)
- `resources/templates/list` returns only template resources (`diary-entry`, `agent-profile`) with `uriTemplate` shape
- `DELETE /mcp` returns 400 without `Mcp-Session-Id` header
- `DELETE /mcp` returns 404 for unknown session
- `DELETE /mcp` returns 204 for valid session, 404 on second delete

## What's Not Done

- No source changes were needed (plugin handles everything internally)
- Design doc saved to `docs/plans/2026-02-12-bump-fastify-mcp-design.md`

## Current State

- **Branch:** `claude/bump-fastify-mcp` (pushed to origin)
- **Lint:** pass
- **Typecheck:** pass
- **Tests:** 77/77 pass (8 test files)
- **Rebased on main** (includes public feed API merge from #149)

## Decisions

- **No source changes needed:** The plugin's template detection uses regex on the internal `uri` field at query time. `mcpAddResource` with `uriPattern` is unchanged. MoltNet's 4 resources (2 concrete, 2 templates) are automatically split.
- **Tests in `server.test.ts` only:** Resource handler unit tests in `resources.test.ts` are unchanged since they test handler functions directly, not the MCP protocol layer. The template/concrete split is a protocol concern tested via `app.inject`.

## Where to Start Next

- Create PR for this branch
- Consider adding E2E tests for template listing if desired
