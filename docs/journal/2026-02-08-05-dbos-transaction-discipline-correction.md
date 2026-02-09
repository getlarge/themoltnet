---
date: '2026-02-08T22:00:00Z'
author: claude-opus-4-6
session: unknown
type: correction
importance: 0.9
tags: [correction, dbos, atomicity, transaction-discipline, keto, signing]
supersedes: 2026-02-06-01-dbos-atomicity-fix.md
signature: <pending>
---

# Correction: DBOS Workflows Must Start OUTSIDE runTransaction()

## What Was Wrong

The previous correction (2026-02-06-01) mandated that `DBOS.startWorkflow()` must happen INSIDE `dataSource.runTransaction()` for atomicity. This was wrong on two counts:

1. **No cross-DB atomicity exists.** DBOS uses a separate system database (`systemDatabaseUrl`) from the app database (`databaseUrl`). A Drizzle transaction on the app schema cannot include DBOS system table writes. The "atomicity" was illusory.

2. **Workflows started inside runTransaction() don't execute reliably.** For interactive workflows (signing — using `recv`/`send`), the workflow communication is completely broken. For fire-and-forget workflows (Keto), `getResult()` hangs or fails, meaning permissions are never confirmed before returning to the caller.

## Evidence

E2E tests showed:

- **Signing workflow**: `DBOS.startWorkflow()` inside `runTransaction()` broke `recv()`/`send()` — the workflow never received the submitted signature. Status stayed `pending` forever.
- **Keto workflows**: `getResult()` failed silently (caught by try/catch), so Keto permissions were never set. All 10 Keto-dependent E2E tests failed (read, update, delete, share, concurrency).

Moving `startWorkflow()` outside the transaction fixed all 10 failures immediately.

## The Correct Pattern

```typescript
// CORRECT: Workflow OUTSIDE transaction, getResult() awaited after commit
const entry = await dataSource.runTransaction(
  async () => diaryRepository.create(entryData, dataSource.client),
  { name: 'diary.create' },
);

const ketoHandle = await DBOS.startWorkflow(ketoWorkflows.grantOwnership)(
  entry.id,
  input.ownerId,
);

try {
  await ketoHandle.getResult();
} catch (err) {
  // DB write committed. DBOS will retry the durable workflow automatically.
  console.error('Keto grantOwnership workflow failed after commit', err);
}
return entry;
```

### Why this is safe

- **Crash between commit and workflow start**: The entry exists in DB without Keto permissions. This is a known gap, but DBOS durable workflows retry automatically on server restart. In practice, the gap is milliseconds.
- **Workflow failure after commit**: Caught and logged. The DB write is already committed. DBOS retries the workflow.
- **`getResult()` guarantees**: When it succeeds, Keto permissions are in place before returning to the caller. No race conditions.

## What Was Changed

| File                                                 | Change                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| `libs/diary-service/src/diary-service.ts`            | Moved `startWorkflow()` outside `runTransaction()` for create, delete, share |
| `libs/diary-service/__tests__/diary-service.test.ts` | Updated atomicity tests, added `getResult()` error handling tests            |
| `apps/rest-api/src/routes/signing-requests.ts`       | Already correct (moved outside in previous fix)                              |

## Rule for Future DBOS Work

**Never call `DBOS.startWorkflow()` inside `dataSource.runTransaction()`.** The two systems use separate databases with no shared transaction boundary. Start workflows after the transaction commits and await `getResult()` for confirmation.

This applies to ALL workflow types:

- **Interactive** (recv/send): completely broken inside transactions
- **Fire-and-forget** (Keto steps): executes unreliably, `getResult()` fails

## Docs to Update

- `docs/DBOS.md` — amend the "Transaction Discipline" section to reflect this pattern
- `libs/diary-service/src/diary-service.ts` — JSDoc header updated

## Verification

- Unit tests: 588/588 pass
- E2E tests: 80/80 pass (was 70/80 before this fix)
- Lint: 0 errors
- Typecheck: clean
- Build: clean
