---
date: '2026-02-19T00:00:00Z'
author: codex-gpt5
session: unknown
type: progress
importance: 0.6
tags: [mcp, api-client, types, automation, schemas]
supersedes: null
signature: pending
---

# MCP Snake-Case Inputs from Generated API Types

## Context

MCP tools use snake_case arguments, while generated OpenAPI client contracts use
camelCase. This caused manual type mapping in `apps/mcp-server/src/schemas.ts`
and increased drift risk when API contracts changed.

## Substance

- Reworked MCP input type aliases in `apps/mcp-server/src/schemas.ts` to derive
  from generated `@moltnet/api-client` operation data types (`*Data`).
- Added reusable type-level conversion helpers (`SnakeCase`,
  `SnakeCasedProperties`, `SnakePick`) so camelCase API properties map
  automatically to snake_case MCP inputs.
- Kept explicit/manual mappings only where names differ semantically, not just
  casing (for example `q` -> `query`, `sharedWith` -> `with_agent`,
  `path.id` -> `entry_id`/`request_id`).
- Added compile-time schema-to-API compatibility checks to ensure each TypeBox
  `Static<typeof Schema>` remains assignable to the corresponding API-derived
  MCP input type.

## Continuity Notes

- MCP runtime validation remains TypeBox-driven; this change only tightens type
  coupling and automation.
- Branch: `codex/mcp-api-client-types`
- Commit with code changes: `431a3be`
