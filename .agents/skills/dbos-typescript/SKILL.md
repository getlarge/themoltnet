---
name: dbos-typescript
description: DBOS TypeScript SDK guidance plus MoltNet-specific authoring, lifecycle, transaction, recovery, bundling, testing, and versioning rules.
license: MIT
metadata:
  author: dbos
  version: "1.0.0"
  organization: DBOS
  date: January 2026
  upstream: https://github.com/dbos-inc/agent-skills
  upstream-revision: 7c08339cb478f08fea3d0d1aaf46b60e9ba76d28
  abstract: Comprehensive guide for building fault-tolerant TypeScript applications with DBOS. Covers workflows, steps, queues, communication patterns, and best practices for durable execution.
---

# DBOS TypeScript Best Practices

Guide for building reliable, fault-tolerant TypeScript applications with DBOS durable workflows.

## MoltNet overlay (takes precedence)

The upstream rules in this skill are the default. Within MoltNet, apply these
repository-specific rules first:

1. Read [workflow determinism](references/workflow-determinism.md) before
   changing workflow bodies, clocks, effects, or concurrency.
2. Read [lifecycle and queues](references/lifecycle-and-queues.md) before
   changing startup, recovery, bundling, schedules, or queue configuration.
3. Read [transactions](references/transactions.md) before changing workflow
   database writes. `TransactionRunner` wraps the DBOS datasource transaction
   with repository AsyncLocalStorage; it does not replace DBOS transactions.
4. Read [MoltNet exceptions](references/moltnet-exceptions.md) before changing
   transactional enqueue or application-version behavior.
5. Use [testing](references/testing.md) to select real-Postgres, crash-gap, and
   process-recovery coverage.
6. Follow [upgrade and versioning](references/upgrade-and-versioning.md) for
   package upgrades and rollout decisions.

Keep workflow bodies deterministic. Put repository writes in registered DBOS
transactions, external effects in retryable steps or child workflows, and DBOS
operations in workflow bodies. Use stable workflow IDs and send idempotency
keys. Do not bundle DBOS, and describe Postgres-to-external-system consistency
as durable reconciliation rather than cross-system atomicity.

## When to Apply

Reference these guidelines when:
- Adding DBOS to existing TypeScript code
- Creating workflows and steps
- Using queues for concurrency control
- Implementing workflow communication (events, messages, streams)
- Configuring and launching DBOS applications
- Using DBOSClient from external applications
- Testing DBOS applications

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Lifecycle | CRITICAL | `lifecycle-` |
| 2 | Workflow | CRITICAL | `workflow-` |
| 3 | Step | HIGH | `step-` |
| 4 | Queue | HIGH | `queue-` |
| 5 | Communication | MEDIUM | `comm-` |
| 6 | Pattern | MEDIUM | `pattern-` |
| 7 | Testing | LOW-MEDIUM | `test-` |
| 8 | Client | MEDIUM | `client-` |
| 9 | Advanced | LOW | `advanced-` |

## Critical Rules

### Installation

For a new standalone project, install the latest DBOS version:

```bash
npm install @dbos-inc/dbos-sdk@latest
```

MoltNet instead pins `@dbos-inc/dbos-sdk` and
`@dbos-inc/drizzle-datasource` together at `4.24.16` through the workspace
catalog. Do not upgrade either package independently.

### DBOS Configuration and Launch

A DBOS application MUST configure and launch DBOS before running any workflows:

```typescript
import { DBOS } from "@dbos-inc/dbos-sdk";

async function main() {
  DBOS.setConfig({
    name: "my-app",
    applicationVersion: "0.1.0",
    systemDatabaseUrl: process.env.DBOS_SYSTEM_DATABASE_URL,
  });
  await DBOS.launch();
  await myWorkflow();
}

main().catch(console.log);
```

When creating a new application, set `applicationVersion` to `"0.1.0"`. If omitted, DBOS derives an opaque hash from workflow source code. When editing an existing application, leave its configured version alone — changing it is a deployment decision (see `references/advanced-versioning.md`). MoltNet intentionally leaves it unset for this rollout; do not enable patching or stamp transactional enqueues without the separate version/drain strategy described in `references/upgrade-and-versioning.md`.

### Workflow and Step Structure

Workflows are comprised of steps. Any function performing complex operations or accessing external services must be run as a step using `DBOS.runStep`:

```typescript
import { DBOS } from "@dbos-inc/dbos-sdk";

async function fetchData() {
  return await fetch("https://api.example.com").then(r => r.json());
}

async function myWorkflowFn() {
  const result = await DBOS.runStep(fetchData, { name: "fetchData" });
  return result;
}
const myWorkflow = DBOS.registerWorkflow(myWorkflowFn);
```

### Key Constraints

- Do NOT call, start, or enqueue workflows from within steps
- Do NOT use threads or uncontrolled concurrency to start workflows - use `DBOS.startWorkflow` or queues
- Workflows MUST be deterministic - non-deterministic operations go in steps
- Do NOT modify global variables from workflows or steps

## How to Use

Read individual rule files for detailed explanations and examples:

```
references/lifecycle-config.md
references/workflow-determinism.md
references/queue-concurrency.md
references/moltnet-exceptions.md
references/upgrade-and-versioning.md
```

## References

- https://docs.dbos.dev/
- https://github.com/dbos-inc/dbos-transact-ts
- [MoltNet upstream provenance](references/upstream.md)
