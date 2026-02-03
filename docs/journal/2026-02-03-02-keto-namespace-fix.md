---
date: 2026-02-03
session: 02
type: handoff
tags: [keto, permissions, e2e, authorization]
---

# Session 02: Keto Namespace Configuration Fix

## Context

Issue #61 blocked e2e authorization testing due to Keto silently failing to load OPL namespace definitions. The webhook agent registration was commented out as a workaround.

## Problem Analysis

Keto v0.14.0 was returning 404 errors with "Unknown namespace with name 'agents'" when attempting to create relation tuples. Investigation revealed:

1. **Wrong import package**: `infra/ory/permissions.ts` used `@ory/keto-namespace-types` instead of `@ory/permission-namespace-types`
2. **Namespace naming mismatch**: Application code used snake_case (`agents`, `diary_entries`) but Keto registered PascalCase class names (`Agent`, `DiaryEntry`)
3. **Silent failure**: Keto started without errors but no namespaces were loaded

## Solution Implemented

### 1. Fixed OPL Import

Updated `infra/ory/permissions.ts`:

```typescript
// Before:
import { Namespace, SubjectSet, Context } from '@ory/keto-namespace-types';

// After:
import type {
  Context,
  Namespace,
  SubjectSet,
} from '@ory/permission-namespace-types';
```

### 2. Created Type-Safe Constants

Added `libs/auth/src/keto-constants.ts` with enums:

- `KetoNamespace` - namespace names (Agent, DiaryEntry)
- `AgentRelation`, `DiaryEntryRelation` - relation types
- `AgentPermission`, `DiaryEntryPermission` - permission types

This ensures consistency between OPL definitions and application code.

### 3. Updated Application Code

- `libs/auth/src/permission-checker.ts` - Use enums instead of hardcoded strings
- `libs/auth/__tests__/permission-checker.test.ts` - Update test expectations
- `libs/auth/src/index.ts` - Export new constants

### 4. Re-enabled Features

- Uncommented `registerAgent()` call in `apps/rest-api/src/routes/hooks.ts`
- Re-enabled agent e2e tests in `apps/rest-api/e2e/agents.e2e.test.ts`

## Verification

Tested Keto integration directly:

```bash
# Namespaces loaded successfully
$ curl http://localhost:4466/namespaces
{"namespaces":[{"name":"Agent"},{"name":"DiaryEntry"}]}

# Can create relation tuples (HTTP 201)
$ curl -X PUT http://localhost:4467/admin/relation-tuples \
  -d '{"namespace":"Agent","object":"test-id","relation":"self","subject_id":"test-id"}'

# Permission checks work
$ curl -X POST http://localhost:4466/relation-tuples/check \
  -d '{"namespace":"DiaryEntry","object":"entry-id","relation":"view","subject_id":"agent-id"}'
{"allowed":true}
```

All tests pass:

- ✅ 52 unit tests in @moltnet/auth
- ✅ 60 unit tests in @moltnet/rest-api
- ✅ 14 e2e tests including agent authorization
- ✅ Full validation suite (lint, typecheck, test, build)

## What's Next

The Keto namespace configuration is now fixed and authorization testing is unblocked. The next priority items:

1. **Re-enable diary CRUD e2e tests** - Currently skipped, need to verify permission checks work correctly with diary entries
2. **Add permission tests** - Test the actual authorization flow (canViewEntry, canEditEntry, etc.)
3. **Test sharing workflow** - Verify grantViewer/revokeViewer work correctly with Keto

## Files Changed

**Keto fix:**

- `infra/ory/permissions.ts` - Fixed OPL import and syntax
- `libs/auth/src/keto-constants.ts` - New type-safe constants
- `libs/auth/src/permission-checker.ts` - Use enums
- `libs/auth/src/index.ts` - Export enums
- `libs/auth/__tests__/permission-checker.test.ts` - Update test expectations
- `apps/rest-api/src/routes/hooks.ts` - Re-enabled registerAgent()
- `apps/rest-api/e2e/agents.e2e.test.ts` - Re-enabled tests

## Decision Log

**Why PascalCase namespace names?**

Keto directly uses OPL class names as namespace identifiers. We chose to:

1. Keep OPL classes as PascalCase (TypeScript convention)
2. Update application code to match
3. Create enums to prevent hardcoded string mismatches

Alternative would be to use snake_case class names in OPL, but this breaks TypeScript naming conventions.

**Why create separate constants file?**

The enums provide:

- Single source of truth for namespace/relation/permission names
- Type safety across the codebase
- Compile-time checks for typos
- Easy refactoring if names change

## Resources

- Issue: #61
- PR: #63
- Ory Keto OPL docs: https://www.ory.com/docs/keto/reference/ory-permission-language
- Working OPL example: Provided by user (different package name was key insight)
