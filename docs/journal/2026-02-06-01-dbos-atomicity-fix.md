---
date: '2026-02-06T18:30:00Z'
author: claude-opus-4-5-20251101
session: unknown
type: correction
importance: 0.8
tags: [correction, dbos, atomicity, diary-service, transaction-discipline]
supersedes: 2026-02-05-03-dbos-transaction-discipline.md
signature: pending
---

# Correction: DBOS Workflow Scheduling Must Happen Inside Transaction

## What Was Wrong

The previous DBOS transaction discipline implementation (2026-02-05-03) had an atomicity bug. The pattern documented was:

```typescript
// WRONG: Workflow scheduling outside transaction
const entry = await dataSource.runTransaction(
  async () => diaryRepository.create(entryData, dataSource.client),
  { name: 'diary.create' },
);
// ← CRASH HERE = entry exists but no Keto workflow scheduled
await DBOS.startWorkflow(ketoWorkflows.grantOwnership)(entry.id, ownerId);
```

This creates a crash window where the database commits but the Keto permission workflow is never scheduled. The result: orphaned diary entries that exist in the database but have no Keto permissions.

## The Correct Pattern

Workflow scheduling MUST happen inside the `runTransaction()` callback:

```typescript
// CORRECT: Workflow scheduling inside transaction
const entry = await dataSource.runTransaction(
  async () => {
    const entry = await diaryRepository.create(entryData, dataSource.client);
    await DBOS.startWorkflow(ketoWorkflows.grantOwnership)(entry.id, ownerId);
    return entry;
  },
  { name: 'diary.create' },
);
```

This ensures that if a crash occurs at any point:

- Either both the DB write and workflow scheduling succeed
- Or both fail and the transaction is rolled back

## What Was Fixed

Three methods in `libs/diary-service/src/diary-service.ts` were corrected:

| Method     | Bug                                                 | Fix          |
| ---------- | --------------------------------------------------- | ------------ |
| `create()` | `grantOwnership` workflow outside transaction       | Moved inside |
| `delete()` | `removeEntryRelations` workflow outside transaction | Moved inside |
| `share()`  | `grantViewer` workflow outside transaction          | Moved inside |

## Tests Added

1. **Execution order tests** (unit): Verify workflow fires inside transaction callback by tracking execution order
2. **Error propagation tests** (unit): Verify workflow errors cause transaction rollback
3. **DBOS integration tests** (new file): Test atomicity with real Postgres + DBOS runtime
4. **E2E concurrency tests** (new file): Test concurrent operations at API level

## Documentation Updated

- `docs/DBOS.md`: Updated "Workflow Pattern" section to show correct pattern
- `libs/diary-service/src/diary-service.ts`: Updated JSDoc header

## Mission Integrity Impact

This fix strengthens T1 (Cryptographic Anchoring) indirectly by ensuring Keto permissions are always granted atomically with diary entry creation. Without this fix:

- Entries could exist without ownership permissions
- Agents could create entries they cannot later access
- Data integrity guarantees would be violated

The fix maintains the separation of data and service (P9) — diary entries remain self-contained with signatures, but Keto permissions now reliably track ownership.

## Branch and Commit

- Branch: `fix/dbos-atomicity`
- Commit: `fix(diary-service): move DBOS workflow scheduling inside transaction for atomicity`
