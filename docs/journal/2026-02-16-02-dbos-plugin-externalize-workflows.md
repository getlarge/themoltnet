---
date: '2026-02-16T19:30:00Z'
author: claude-opus-4-6
session: dbos-plugin-externalize-workflows
type: decision
importance: 0.6
tags: [dbos, plugin, refactor, diary-workflows, architecture]
signature: <pending>
---

# Decision: Externalize DBOS Workflow Registration via Callbacks

## Context

The DBOS Fastify plugin (`apps/rest-api/src/plugins/dbos.ts`) hardcoded all workflow initialization — directly importing and calling `initSigningWorkflows()`, `initRegistrationWorkflow()`, `initKetoWorkflows()`, plus wiring their dependencies. Adding or removing a workflow meant editing the plugin itself. Keto workflows were also dead code (initialized but never invoked).

## What Changed

### Plugin becomes a generic DBOS lifecycle manager

The plugin now accepts two callback arrays in options:

- `registerWorkflows: Array<() => void>` — called after `configureDBOS()`, before `initDBOS()`. Each callback registers workflow definitions and sets pre-launch deps.
- `afterLaunch: Array<(dataSource: DataSource) => void>` — called after `launchDBOS()`. Receives the DBOS dataSource for post-launch dependency injection.

All workflow-specific imports were removed from the plugin. It only imports DBOS lifecycle functions: `configureDBOS`, `initDBOS`, `launchDBOS`, `shutdownDBOS`, `getDataSource`.

### Bootstrap wires everything

`bootstrap.ts` now owns all workflow init and dependency wiring via closures passed to the plugin options. This makes the plugin reusable and keeps domain knowledge in the bootstrap layer.

### Dead code removed

- `initKetoWorkflows()` and `setKetoRelationshipWriter()` — were initialized but never called from any route handler.
- `identityApi`/`oauth2Api` plugin options — only used by registration workflow, now wired in bootstrap callbacks.
- Precondition checks for Fastify decorations — the plugin no longer reads them directly.

### Diary workflows added

- Added `@moltnet/diary-service/workflows` subpath export for `initDiaryWorkflows` and `setDiaryWorkflowDeps`.
- Added `DiaryRepository.unshare()` method in `@moltnet/database` for share compensation.
- Widened `DiaryRepository.create()` to accept optional `id` for deterministic DBOS workflow replay.
- Updated `DiaryRepository` interface in diary-service types to match.

## Continuity Notes

- The diary workflow source (`libs/diary-service/src/workflows/diary-workflows.ts`) and its tests are now committed and wired into the bootstrap.
- All 200 rest-api tests pass. Typecheck is clean after the type fixes.
- The diary workflows themselves (create, update, delete, share with compensation) are functional but haven't been exercised via E2E tests yet.
