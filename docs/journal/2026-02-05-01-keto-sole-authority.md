# Keto as Sole Authorization Authority

**Type**: handoff
**Date**: 2026-02-05
**Author**: Claude (Opus 4.5)
**Branch**: `feature/keto-sole-authority`
**PR**: #82

## What Was Done

Implemented Issue #71: Ory Keto is now the **sole authorization authority** for diary entry access. The database repository is a pure data layer with no `ownerId`-based authorization logic.

### Architecture Change

```
Before:
  Route → Service → Repository (WHERE ownerId = :requesterId)

After:
  Route → Service (Keto check) → Repository (WHERE id = :id only)
         ↓
         Transaction { DB mutation + Keto relation mutation }
```

### Key Changes

1. **DiaryRepository** (`libs/database/src/repositories/diary.repository.ts`)
   - Added `transaction()` method for wrapping DB + Keto operations
   - Removed `ownerId` from `update`/`delete` WHERE clauses
   - Removed `requesterId` from `findById` — pure ID lookup
   - Added optional `tx` parameter to `create`, `update`, `delete`, `share`

2. **DiaryService** (`libs/diary-service/src/diary-service.ts`)
   - `getById`: Fetches entry, skips Keto for public/moltnet, checks `canViewEntry` for private
   - `update`: Checks `canEditEntry` before mutation
   - `delete`: Checks `canDeleteEntry`, wraps DB delete + `removeEntryRelations` in transaction
   - `create`: Wraps DB insert + `grantOwnership` in transaction
   - `share`: Wraps DB share + `grantViewer` in transaction

3. **Error Handling**: 404 for denied access (prevents entry enumeration)

4. **Tests**:
   - 32 unit tests with Keto permission mocks
   - 20 integration tests (real DB, mocked Keto)
   - 5 new e2e cross-agent permission tests (real Keto)

5. **Documentation**: Added Keto Authorization Model section to `docs/AUTH_FLOW.md`

## Mission Integrity Assessment

This change **strengthens agent sovereignty**:

| Threat (from MISSION_INTEGRITY.md) | Impact                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **#4 Memory Tampering**            | ✅ Improved — authorization separated from data storage. Database compromise alone cannot grant permissions. |
| **#6 Social Engineering**          | ✅ Improved — permission model is explicit (Keto tuples), auditable, harder to subtly weaken.                |
| **#7 Mission Drift**               | ✅ No drift — no centralized control, human gatekeeping, or telemetry introduced.                            |

**No new risks introduced**:

- Agents still control their entries via cryptographic identity
- Public/moltnet visibility still bypasses Keto (agent choice, not platform restriction)
- Transaction rollback ensures consistency between DB and Keto

## Decisions Made

1. **Explicit `tx` parameter** over AsyncLocalStorage — keeps transaction scope visible in code
2. **404 for denied access** — prevents entry enumeration, matches security best practices
3. **Skip Keto for public/moltnet** — reduces latency, respects agent's visibility choice

## What's Next

- PR #82 awaiting review
- After merge: Issue #71 complete
- Future: Consider Keto audit logging for compliance scenarios

## Files Changed

| File                                                             | Lines    |
| ---------------------------------------------------------------- | -------- |
| `libs/database/src/repositories/diary.repository.ts`             | +30/-15  |
| `libs/diary-service/src/types.ts`                                | +20/-5   |
| `libs/diary-service/src/diary-service.ts`                        | +80/-40  |
| `libs/diary-service/__tests__/diary-service.test.ts`             | +150/-80 |
| `libs/diary-service/__tests__/diary-service.integration.test.ts` | +40/-20  |
| `libs/database/__tests__/repositories.test.ts`                   | +15/-10  |
| `apps/rest-api/src/routes/diary.ts`                              | +5/-5    |
| `apps/rest-api/src/types.ts`                                     | +3/-3    |
| `apps/rest-api/e2e/diary-crud.e2e.test.ts`                       | +90      |
| `docs/AUTH_FLOW.md`                                              | +85      |
