# Keto Entry Parent Relation + E2E Coverage Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the dual-auth model (replace `DiaryEntry#owner@Agent` with transitive `DiaryEntry#parent@Diary`), remove dead code from the old entry-sharing system, and fill all identified e2e coverage gaps.

**Architecture:** Entries gain permissions transitively through their parent Diary. When an entry is created, the workflow writes `DiaryEntry:{id}#parent@Diary:{diaryId}` (a subject_set tuple). Keto's OPL then traverses the parent to resolve `view/edit/delete` by checking the parent Diary's `read`/`write` permit. This means any agent who can `read` the diary can also `view` its entries — no per-entry tuples needed for shared agents.

**Tech Stack:** TypeScript, Ory Keto OPL (`infra/ory/permissions.ts`), Drizzle, Fastify, Vitest, `@ory/client-fetch`

---

## Task 1: Rewrite DiaryEntry OPL class

**Files:**

- Modify: `infra/ory/permissions.ts`

**Step 1: Replace the DiaryEntry class**

```typescript
/**
 * DiaryEntry namespace
 * Permissions are inherited transitively from the parent Diary.
 * The sole relation is `parent: Diary[]` — one entry belongs to one diary.
 *
 * Relation tuple written on entry creation:
 *   DiaryEntry:{entryId}#parent @ Diary:{diaryId}#  (subject_set with relation "")
 *
 * Transitive checks:
 *   canViewEntry(entryId, agentId)   → DiaryEntry#{entryId} view  agentId → parent.read
 *   canEditEntry(entryId, agentId)   → DiaryEntry#{entryId} edit  agentId → parent.write
 *   canDeleteEntry(entryId, agentId) → DiaryEntry#{entryId} delete agentId → parent.write
 */
class DiaryEntry implements Namespace {
  related: {
    // The diary that owns this entry — one tuple per entry
    parent: Diary[];
  };

  permits = {
    view: (ctx: Context) =>
      this.related.parent.traverse((d) => d.permits.read(ctx)),

    edit: (ctx: Context) =>
      this.related.parent.traverse((d) => d.permits.write(ctx)),

    delete: (ctx: Context) =>
      this.related.parent.traverse((d) => d.permits.write(ctx)),
  };
}
```

Remove the old example comment block at the bottom of the file that references `diary_entries:entry_123#owner@agents:claude`.

**Step 2: Verify the file compiles**

The `infra/ory/` package uses TypeScript for authoring but the OPL file itself is the source of truth for the Keto configuration. Run:

```bash
pnpm run typecheck
```

Expected: PASS

**Step 3: Commit**

```bash
git add infra/ory/permissions.ts
git commit -m "feat(ory): rewrite DiaryEntry OPL with transitive parent relation"
```

---

## Task 2: Remove stale Keto constants

**Files:**

- Modify: `libs/auth/src/keto-constants.ts`

**Step 1: Remove Owner, Viewer from DiaryEntryRelation; remove Share from DiaryEntryPermission**

```typescript
/**
 * Relations for the DiaryEntry namespace
 * Only `parent` remains — the object is linked to its Diary via a subject_set.
 */
export enum DiaryEntryRelation {
  Parent = 'parent',
}

/**
 * Permissions for the DiaryEntry namespace
 */
export enum DiaryEntryPermission {
  View = 'view',
  Edit = 'edit',
  Delete = 'delete',
}
```

**Step 2: Run typecheck — expect failures**

```bash
pnpm run typecheck
```

Expected: FAIL — `DiaryEntryRelation.Owner`, `DiaryEntryRelation.Viewer`, `DiaryEntryPermission.Share` referenced in other files. The subsequent tasks fix these.

**Step 3: Commit after all referencing code is fixed (defer to end of Task 4)**

---

## Task 3: Replace grantOwnership with grantEntryParent

**Files:**

- Modify: `libs/auth/src/relationship-writer.ts`
- Modify: `libs/diary-service/src/types.ts`

**Step 1: Update the interface in `libs/auth/src/relationship-writer.ts`**

Change the `RelationshipWriter` interface (lines 17-26) — replace `grantOwnership` with `grantEntryParent`:

```typescript
export interface RelationshipWriter {
  grantDiaryOwner(diaryId: string, agentId: string): Promise<void>;
  grantDiaryWriter(diaryId: string, agentId: string): Promise<void>;
  grantDiaryReader(diaryId: string, agentId: string): Promise<void>;
  removeDiaryRelations(diaryId: string): Promise<void>;
  removeDiaryRelationForAgent(diaryId: string, agentId: string): Promise<void>;
  grantEntryParent(entryId: string, diaryId: string): Promise<void>;
  registerAgent(agentId: string): Promise<void>;
  removeEntryRelations(entryId: string): Promise<void>;
}
```

**Step 2: Replace the grantOwnership implementation (lines 90-99)**

Delete the `grantOwnership` method and replace with `grantEntryParent`. This uses `subject_set` instead of `subject_id` to point to the Diary object (not an Agent):

```typescript
async grantEntryParent(entryId: string, diaryId: string): Promise<void> {
  await relationshipApi.createRelationship({
    createRelationshipBody: {
      namespace: KetoNamespace.DiaryEntry,
      object: entryId,
      relation: DiaryEntryRelation.Parent,
      subject_set: {
        namespace: KetoNamespace.Diary,
        object: diaryId,
        relation: '',
      },
    },
  });
},
```

Also remove the now-unused `DiaryEntryRelation` import items `Owner` and `Viewer` (only `Parent` is needed).

**Step 3: Update `libs/diary-service/src/types.ts` RelationshipWriter interface (lines 284-293)**

```typescript
export interface RelationshipWriter {
  grantEntryParent(entryId: string, diaryId: string): Promise<void>;
  registerAgent(agentId: string): Promise<void>;
  removeEntryRelations(entryId: string): Promise<void>;
  grantDiaryOwner(diaryId: string, agentId: string): Promise<void>;
  grantDiaryWriter(diaryId: string, agentId: string): Promise<void>;
  grantDiaryReader(diaryId: string, agentId: string): Promise<void>;
  removeDiaryRelations(diaryId: string): Promise<void>;
  removeDiaryRelationForAgent(diaryId: string, agentId: string): Promise<void>;
}
```

**Step 4: Run typecheck**

```bash
pnpm run typecheck
```

Expected: FAIL until Tasks 5-8 update callers.

---

## Task 4: Remove canShareEntry

**Files:**

- Modify: `libs/auth/src/permission-checker.ts`

**Step 1: Remove canShareEntry from the interface (line 23) and implementation (lines 110-118)**

The `libs/auth/src/permission-checker.ts` interface (lines 16-24):

```typescript
export interface PermissionChecker {
  canReadDiary(diaryId: string, agentId: string): Promise<boolean>;
  canWriteDiary(diaryId: string, agentId: string): Promise<boolean>;
  canManageDiary(diaryId: string, agentId: string): Promise<boolean>;
  canViewEntry(entryId: string, agentId: string): Promise<boolean>;
  canEditEntry(entryId: string, agentId: string): Promise<boolean>;
  canDeleteEntry(entryId: string, agentId: string): Promise<boolean>;
}
```

Delete `canShareEntry` method from the `createPermissionChecker` return object (lines 110-118).

Remove `DiaryEntryPermission.Share` from the import — only `View`, `Edit`, `Delete` remain.

**Step 2: Commit Tasks 2-4 together**

```bash
git add libs/auth/src/keto-constants.ts libs/auth/src/relationship-writer.ts \
        libs/auth/src/permission-checker.ts libs/diary-service/src/types.ts
git commit -m "feat(auth): replace grantOwnership with grantEntryParent (subject_set); remove canShareEntry"
```

---

## Task 5: Remove requesterId from CreateEntryInput

**Files:**

- Modify: `libs/diary-service/src/types.ts`

**Step 1: Remove requesterId field from CreateEntryInput (lines 115-124)**

```typescript
export interface CreateEntryInput {
  diaryId: string;
  content: string;
  title?: string;
  tags?: string[];
  importance?: number;
  entryType?: EntryType;
}
```

**Step 2: Run typecheck**

```bash
pnpm run typecheck
```

Expected: FAIL — callers still pass `requesterId`. Fixed in Tasks 6-7.

---

## Task 6: Update diary workflows

**Files:**

- Modify: `libs/diary-service/src/workflows/diary-workflows.ts`

**Step 1: Rename grantOwnershipStep to grantEntryParentStep**

Replace the `grantOwnershipStep` registration (~lines 144-150):

```typescript
const grantEntryParentStep = DBOS.registerStep(
  async (entryId: string, diaryId: string): Promise<void> => {
    const { relationshipWriter } = getDeps();
    await relationshipWriter.grantEntryParent(entryId, diaryId);
  },
  { name: 'diary.step.grantEntryParent', ...KETO_RETRY },
);
```

**Step 2: Update the createEntry workflow to use grantEntryParentStep**

In the `createEntry` workflow (~lines 164-208):

1. Remove `input.requesterId` from the call — replace:

   ```typescript
   await grantOwnershipStep(entry.id, input.requesterId);
   ```

   with:

   ```typescript
   await grantEntryParentStep(entry.id, input.diaryId);
   ```

2. Update the error message (line 202):
   ```typescript
   throw new Error('Failed to link entry to diary after creation');
   ```

**Step 3: Run tests**

```bash
pnpm --filter @moltnet/diary-service run test
```

Expected: FAIL — unit tests still assert old method names. Fixed in Task 8.

---

## Task 7: Update diary-service create call

**Files:**

- Modify: `libs/diary-service/src/diary-service.ts`

**Step 1: Update the authorization model comment (lines 12-19)**

Replace the stale entry in the ASCII table:

```
│ diary_entries      │ INSERT       │ DiaryEntry:{id}#parent@Diary:{diaryId}#    │
```

(Remove the old `│ diary_entries      │ INSERT       │ DiaryEntry:{id}#owner@Agent:{requesterId}  │` line.)

**Step 2: Remove requesterId from the create() call**

Find the `create()` method. It calls `diaryWorkflows.createEntry(...)` with `requesterId`. Remove that field:

```typescript
return diaryWorkflows.createEntry({
  diaryId: input.diaryId,
  content: input.content,
  title: input.title,
  tags: input.tags,
  importance: input.importance,
  entryType: input.entryType,
});
```

**Step 3: Run typecheck**

```bash
pnpm run typecheck
```

Expected: FAIL until route handler is updated in Task 8.

---

## Task 8: Update route handler and fix description

**Files:**

- Modify: `apps/rest-api/src/routes/diary.ts`

**Step 1: Remove requesterId from the createDiaryEntry route handler**

Find the `POST /diaries/:diaryRef/entries` handler. Remove `requesterId` from the `diaryService.create()` call. The `diaryId` is already available as `diary.id`:

```typescript
// Before
const entry = await diaryService.create({
  requesterId: auth.identityId,
  diaryId: diary.id,
  ...
});

// After
const entry = await diaryService.create({
  diaryId: diary.id,
  ...
});
```

**Step 2: Fix updateDiaryEntry description (M3)**

Find the `PUT /diaries/:diaryRef/entries/:entryId` route's `description` string. Remove "visibility" from the field list:

```typescript
// Before: description: 'Update diary entry content, title, visibility, tags, ...'
// After:  description: 'Update diary entry content, title, tags, ...'
```

**Step 3: Run typecheck and tests**

```bash
pnpm run typecheck && pnpm run test
```

Expected: typecheck PASS; some unit tests FAIL (assertions reference old `requesterId`). Fixed in Task 9.

**Step 4: Commit Tasks 5-8**

```bash
git add libs/diary-service/src/types.ts libs/diary-service/src/workflows/diary-workflows.ts \
        libs/diary-service/src/diary-service.ts apps/rest-api/src/routes/diary.ts
git commit -m "feat(diary): remove requesterId from CreateEntryInput, wire grantEntryParent"
```

---

## Task 9: Update relationship-writer unit tests

**Files:**

- Modify: `libs/auth/__tests__/relationship-writer.test.ts`

**Step 1: Replace the grantOwnership describe block (lines 112-137) with grantEntryParent**

```typescript
describe('grantEntryParent', () => {
  it('creates parent relation tuple using subject_set', async () => {
    mockRelationshipApi.createRelationship.mockResolvedValue({});

    await writer.grantEntryParent(ENTRY_ID, DIARY_ID);

    expect(mockRelationshipApi.createRelationship).toHaveBeenCalledWith({
      createRelationshipBody: {
        namespace: 'DiaryEntry',
        object: ENTRY_ID,
        relation: 'parent',
        subject_set: {
          namespace: 'Diary',
          object: DIARY_ID,
          relation: '',
        },
      },
    });
  });

  it('throws on API error', async () => {
    mockRelationshipApi.createRelationship.mockRejectedValue(
      new Error('Keto unavailable'),
    );

    await expect(writer.grantEntryParent(ENTRY_ID, DIARY_ID)).rejects.toThrow(
      'Keto unavailable',
    );
  });
});
```

**Step 2: Run the tests**

```bash
pnpm --filter @moltnet/auth run test
```

Expected: PASS

**Step 3: Commit**

```bash
git add libs/auth/__tests__/relationship-writer.test.ts
git commit -m "test(auth): update relationship-writer tests for grantEntryParent"
```

---

## Task 10: Update diary-workflows unit tests

**Files:**

- Modify: `libs/diary-service/__tests__/diary-workflows.test.ts`

**Step 1: Update createMockRelationshipWriter (lines 70-78)**

Replace `grantOwnership` with `grantEntryParent`:

```typescript
function createMockRelationshipWriter(): {
  [K in keyof RelationshipWriter]: ReturnType<typeof vi.fn>;
} {
  return {
    grantEntryParent: vi.fn().mockResolvedValue(undefined),
    registerAgent: vi.fn().mockResolvedValue(undefined),
    removeEntryRelations: vi.fn().mockResolvedValue(undefined),
    grantDiaryOwner: vi.fn().mockResolvedValue(undefined),
    grantDiaryWriter: vi.fn().mockResolvedValue(undefined),
    grantDiaryReader: vi.fn().mockResolvedValue(undefined),
    removeDiaryRelations: vi.fn().mockResolvedValue(undefined),
    removeDiaryRelationForAgent: vi.fn().mockResolvedValue(undefined),
  };
}
```

**Step 2: Update createEntry test — remove requesterId, assert grantEntryParent (lines 122-153)**

```typescript
it('creates entry with embedding and links to parent diary', async () => {
  const mockEntry = createMockEntry({ id: GENERATED_ID });
  embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
  repo.create.mockResolvedValue(mockEntry);

  const { diaryWorkflows } =
    await import('../src/workflows/diary-workflows.js');

  const result = await diaryWorkflows.createEntry({
    diaryId: DIARY_ID,
    content: 'Test diary entry content',
  });

  expect(result).toEqual(mockEntry);
  expect(repo.create).toHaveBeenCalledWith(
    expect.objectContaining({
      diaryId: DIARY_ID,
      content: 'Test diary entry content',
      embedding: MOCK_EMBEDDING,
      injectionRisk: false,
    }),
  );
  expect(writer.grantEntryParent).toHaveBeenCalledWith(mockEntry.id, DIARY_ID);
});
```

**Step 3: Update remaining createEntry tests to remove requesterId**

All calls to `diaryWorkflows.createEntry({...})` should remove `requesterId: OWNER_ID`.

**Step 4: Update compensation test (line 200-220)**

```typescript
it('compensates by deleting entry when grantEntryParent fails', async () => {
  const mockEntry = createMockEntry();
  embeddings.embedPassage.mockResolvedValue([]);
  repo.create.mockResolvedValue(mockEntry);
  writer.grantEntryParent.mockRejectedValue(new Error('Keto unavailable'));
  repo.delete.mockResolvedValue(true);

  const { diaryWorkflows } =
    await import('../src/workflows/diary-workflows.js');

  await expect(
    diaryWorkflows.createEntry({
      diaryId: DIARY_ID,
      content: 'Test content',
    }),
  ).rejects.toThrow('Failed to link entry to diary after creation');

  expect(repo.delete).toHaveBeenCalledWith(mockEntry.id);
});
```

**Step 5: Run the tests**

```bash
pnpm --filter @moltnet/diary-service run test
```

Expected: PASS

**Step 6: Commit**

```bash
git add libs/diary-service/__tests__/diary-workflows.test.ts
git commit -m "test(diary-service): update workflow tests for grantEntryParent, remove requesterId"
```

---

## Task 11: Update plugin.test.ts and diary.test.ts mocks

**Files:**

- Modify: `libs/auth/__tests__/plugin.test.ts`
- Modify: `apps/rest-api/__tests__/diary.test.ts`

**Step 1: Fix plugin.test.ts createMockPermissionChecker (line 28-35)**

Remove `canShareEntry`:

```typescript
function createMockPermissionChecker() {
  return {
    canViewEntry: vi.fn(),
    canEditEntry: vi.fn(),
    canDeleteEntry: vi.fn(),
    canReadDiary: vi.fn(),
    canWriteDiary: vi.fn(),
    canManageDiary: vi.fn(),
  };
}
```

**Step 2: Fix plugin.test.ts createMockRelationshipWriter (line 37-43)**

Replace `grantOwnership` with `grantEntryParent`:

```typescript
function createMockRelationshipWriter() {
  return {
    grantEntryParent: vi.fn(),
    registerAgent: vi.fn(),
    removeEntryRelations: vi.fn(),
    grantDiaryOwner: vi.fn(),
    grantDiaryWriter: vi.fn(),
    grantDiaryReader: vi.fn(),
    removeDiaryRelations: vi.fn(),
    removeDiaryRelationForAgent: vi.fn(),
  };
}
```

**Step 3: Fix diary.test.ts createEntry assertion (lines 54-62)**

Remove `requesterId: OWNER_ID` from the expected call:

```typescript
expect(mocks.diaryService.create).toHaveBeenCalledWith({
  diaryId: DIARY_ID,
  content: 'Test diary entry content',
  title: undefined,
  tags: undefined,
  importance: undefined,
  entryType: undefined,
});
```

**Step 4: Run all unit tests**

```bash
pnpm run test
```

Expected: ALL PASS

**Step 5: Run typecheck**

```bash
pnpm run typecheck
```

Expected: PASS

**Step 6: Commit**

```bash
git add libs/auth/__tests__/plugin.test.ts apps/rest-api/__tests__/diary.test.ts
git commit -m "test: update mocks for grantEntryParent and remove canShareEntry"
```

---

## Task 12: Add 401 tests to diary-management.e2e.test.ts

**Files:**

- Modify: `apps/rest-api/e2e/diary-management.e2e.test.ts`

**Step 1: Add a dedicated "unauthorized access" describe block**

These tests verify every management endpoint returns 401 when called without a bearer token. Add after the existing `Keto permission boundary` describe block:

```typescript
describe('Unauthorized access (no token)', () => {
  it('POST /diaries returns 401', async () => {
    const response = await fetch(`${harness.baseUrl}/diaries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'my-diary' }),
    });
    expect(response.status).toBe(401);
  });

  it('DELETE /diaries/:id returns 401', async () => {
    const response = await fetch(
      `${harness.baseUrl}/diaries/${agentA.privateDiaryId}`,
      { method: 'DELETE' },
    );
    expect(response.status).toBe(401);
  });

  it('POST /diaries/:id/share returns 401', async () => {
    const response = await fetch(
      `${harness.baseUrl}/diaries/${agentA.privateDiaryId}/share`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fingerprint: 'AAAA-BBBB-CCCC-DDDD',
          role: 'reader',
        }),
      },
    );
    expect(response.status).toBe(401);
  });

  it('GET /diaries/:id/shares returns 401', async () => {
    const response = await fetch(
      `${harness.baseUrl}/diaries/${agentA.privateDiaryId}/shares`,
    );
    expect(response.status).toBe(401);
  });

  it('DELETE /diaries/:id/share/:fingerprint returns 401', async () => {
    const response = await fetch(
      `${harness.baseUrl}/diaries/${agentA.privateDiaryId}/share/AAAA-BBBB-CCCC-DDDD`,
      { method: 'DELETE' },
    );
    expect(response.status).toBe(401);
  });

  it('GET /diaries/invitations returns 401', async () => {
    const response = await fetch(`${harness.baseUrl}/diaries/invitations`);
    expect(response.status).toBe(401);
  });

  it('POST /diaries/invitations/:id/accept returns 401', async () => {
    const response = await fetch(
      `${harness.baseUrl}/diaries/invitations/fake-id/accept`,
      { method: 'POST' },
    );
    expect(response.status).toBe(401);
  });

  it('POST /diaries/invitations/:id/decline returns 401', async () => {
    const response = await fetch(
      `${harness.baseUrl}/diaries/invitations/fake-id/decline`,
      { method: 'POST' },
    );
    expect(response.status).toBe(401);
  });
});
```

Note: `agentA` must be accessible in this scope (it is, as a `let` in the outer `describe`).

**Step 2: Add invitation isolation tests**

Add after the 401 block:

```typescript
describe('Invitation isolation', () => {
  let shareId: string;

  beforeAll(async () => {
    // agentA invites agentB to read their diary
    const { data } = await shareDiary({
      client,
      auth: () => agentA.accessToken,
      path: { diaryId: agentA.privateDiaryId },
      body: { fingerprint: agentB.fingerprint, role: 'reader' },
    });
    shareId = data!.id;
  });

  it('agentA cannot accept their own invitation', async () => {
    const response = await fetch(
      `${harness.baseUrl}/diaries/invitations/${shareId}/accept`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${agentA.accessToken}` },
      },
    );
    // Not the recipient — expect 404 (invitation not found for this agent)
    expect(response.status).toBe(404);
  });

  it('agentB can accept the invitation', async () => {
    const response = await fetch(
      `${harness.baseUrl}/diaries/invitations/${shareId}/accept`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${agentB.accessToken}` },
      },
    );
    expect(response.status).toBe(200);
  });

  it('agentB cannot accept the same invitation twice', async () => {
    const response = await fetch(
      `${harness.baseUrl}/diaries/invitations/${shareId}/accept`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${agentB.accessToken}` },
      },
    );
    // Already accepted — wrong_status error
    expect(response.status).toBe(409);
  });
});
```

**Step 3: Verify agentB fixture exists**

The management test file already has an `agentB`. If not, add it in `beforeAll`:

```typescript
// Existing pattern from the file — second agent
const voucherB = await createTestVoucher({
  db: harness.db,
  issuerId: harness.bootstrapIdentityId,
});
agentB = await createAgent({
  baseUrl: harness.baseUrl,
  identityApi: harness.identityApi,
  hydraAdminOAuth2: harness.hydraAdminOAuth2,
  webhookApiKey: harness.webhookApiKey,
  voucherCode: voucherB,
});
```

---

## Task 13: Add writer/reader entry access tests (validates Keto model)

**Files:**

- Modify: `apps/rest-api/e2e/diary-management.e2e.test.ts`

These are the key tests validating the new transitive Keto model. A writer can create/update/delete entries; a reader can only read them.

**Step 1: Add shared diary entry access describe block**

Add after the invitation isolation tests:

```typescript
describe('Shared diary entry access (transitive Keto permissions)', () => {
  // agentA's diary shared with agentB (writer) and agentC (reader)
  let agentC: TestAgent;
  let sharedDiaryId: string;
  let writerShareId: string;
  let readerShareId: string;

  beforeAll(async () => {
    // Create a third agent (reader)
    const voucherC = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });
    agentC = await createAgent({
      baseUrl: harness.baseUrl,
      identityApi: harness.identityApi,
      hydraAdminOAuth2: harness.hydraAdminOAuth2,
      webhookApiKey: harness.webhookApiKey,
      voucherCode: voucherC,
    });

    // agentA creates a second diary for sharing tests
    const { data: newDiary } = await createDiary({
      client,
      auth: () => agentA.accessToken,
      body: { name: 'shared-diary' },
    });
    sharedDiaryId = newDiary!.id;

    // Invite agentB as writer
    const { data: writerShare } = await shareDiary({
      client,
      auth: () => agentA.accessToken,
      path: { diaryId: sharedDiaryId },
      body: { fingerprint: agentB.fingerprint, role: 'writer' },
    });
    writerShareId = writerShare!.id;

    // Invite agentC as reader
    const { data: readerShare } = await shareDiary({
      client,
      auth: () => agentA.accessToken,
      path: { diaryId: sharedDiaryId },
      body: { fingerprint: agentC.fingerprint, role: 'reader' },
    });
    readerShareId = readerShare!.id;

    // Both accept their invitations
    await fetch(
      `${harness.baseUrl}/diaries/invitations/${writerShareId}/accept`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${agentB.accessToken}` },
      },
    );
    await fetch(
      `${harness.baseUrl}/diaries/invitations/${readerShareId}/accept`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${agentC.accessToken}` },
      },
    );
  });

  it('owner (agentA) can create entries in shared diary', async () => {
    const { data, error } = await createDiaryEntry({
      client,
      auth: () => agentA.accessToken,
      path: { diaryId: sharedDiaryId },
      body: { content: 'Owner entry in shared diary' },
    });
    expect(error).toBeUndefined();
    expect(data).toBeDefined();
  });

  it('writer (agentB) can create entries in shared diary', async () => {
    const { data, error } = await createDiaryEntry({
      client,
      auth: () => agentB.accessToken,
      path: { diaryId: sharedDiaryId },
      body: { content: 'Writer entry in shared diary' },
    });
    expect(error).toBeUndefined();
    expect(data).toBeDefined();
  });

  it('reader (agentC) cannot create entries in shared diary (403)', async () => {
    const { error } = await createDiaryEntry({
      client,
      auth: () => agentC.accessToken,
      path: { diaryId: sharedDiaryId },
      body: { content: 'Reader trying to create entry' },
    });
    expect(error).toBeDefined();
    // @ts-expect-error error shape
    expect(error.statusCode ?? error.status).toBe(403);
  });

  it('writer (agentB) can read entries in shared diary', async () => {
    const { data, error } = await listDiaryEntries({
      client,
      auth: () => agentB.accessToken,
      path: { diaryId: sharedDiaryId },
    });
    expect(error).toBeUndefined();
    expect(
      (data as unknown as { items: unknown[] }).items.length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('reader (agentC) can read entries in shared diary', async () => {
    const { data, error } = await listDiaryEntries({
      client,
      auth: () => agentC.accessToken,
      path: { diaryId: sharedDiaryId },
    });
    expect(error).toBeUndefined();
    expect(
      (data as unknown as { items: unknown[] }).items.length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('writer (agentB) can update an entry they created in shared diary', async () => {
    // Create an entry as writer
    const { data: created } = await createDiaryEntry({
      client,
      auth: () => agentB.accessToken,
      path: { diaryId: sharedDiaryId },
      body: { content: 'Writer entry to update' },
    });

    const { data: updated, error } = await updateDiaryEntry({
      client,
      auth: () => agentB.accessToken,
      path: { diaryId: sharedDiaryId, entryId: created!.id },
      body: { content: 'Updated by writer' },
    });
    expect(error).toBeUndefined();
    expect(updated!.content).toBe('Updated by writer');
  });

  it('reader (agentC) cannot update entries in shared diary (403)', async () => {
    // Get an entry to try to update
    const { data: list } = await listDiaryEntries({
      client,
      auth: () => agentC.accessToken,
      path: { diaryId: sharedDiaryId },
    });
    const entries = (list as unknown as { items: Array<{ id: string }> }).items;
    expect(entries.length).toBeGreaterThanOrEqual(1);

    const { error } = await updateDiaryEntry({
      client,
      auth: () => agentC.accessToken,
      path: { diaryId: sharedDiaryId, entryId: entries[0].id },
      body: { content: 'Reader trying to update' },
    });
    expect(error).toBeDefined();
    // @ts-expect-error error shape
    expect(error.statusCode ?? error.status).toBe(403);
  });

  it('reader (agentC) cannot delete entries in shared diary (403)', async () => {
    const { data: list } = await listDiaryEntries({
      client,
      auth: () => agentC.accessToken,
      path: { diaryId: sharedDiaryId },
    });
    const entries = (list as unknown as { items: Array<{ id: string }> }).items;

    const { error } = await deleteDiaryEntry({
      client,
      auth: () => agentC.accessToken,
      path: { diaryId: sharedDiaryId, entryId: entries[0].id },
    });
    expect(error).toBeDefined();
    // @ts-expect-error error shape
    expect(error.statusCode ?? error.status).toBe(403);
  });

  it('unauthorized agent cannot access shared diary entries', async () => {
    // agentA's other (private) diary is inaccessible to agentB
    const { error } = await listDiaryEntries({
      client,
      auth: () => agentB.accessToken,
      path: { diaryId: agentA.privateDiaryId },
    });
    expect(error).toBeDefined();
    // @ts-expect-error error shape
    expect(error.statusCode ?? error.status).toBe(403);
  });
});
```

Note: `createDiaryEntry`, `updateDiaryEntry`, `deleteDiaryEntry`, `listDiaryEntries` helpers need to be imported. Check what the management file already imports and add what's missing from `@moltnet/api-client`.

---

## Task 14: Add 401 tests to search and crud e2e

**Files:**

- Modify: `apps/rest-api/e2e/diary-crud.e2e.test.ts`
- Modify: `apps/rest-api/e2e/diary-search.e2e.test.ts`

**Step 1: Add to diary-crud.e2e.test.ts**

Add a new describe block at the end:

```typescript
describe('Unauthorized access (no token)', () => {
  it('GET /diaries/:id/entries returns 401 without token', async () => {
    const response = await fetch(
      `${harness.baseUrl}/diaries/${agent.privateDiaryId}/entries`,
    );
    expect(response.status).toBe(401);
  });

  it('GET /diaries/:id/entries/:entryId returns 401 without token', async () => {
    const response = await fetch(
      `${harness.baseUrl}/diaries/${agent.privateDiaryId}/entries/fake-id`,
    );
    expect(response.status).toBe(401);
  });

  it('PUT /diaries/:id/entries/:entryId returns 401 without token', async () => {
    const response = await fetch(
      `${harness.baseUrl}/diaries/${agent.privateDiaryId}/entries/fake-id`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'update' }),
      },
    );
    expect(response.status).toBe(401);
  });

  it('DELETE /diaries/:id/entries/:entryId returns 401 without token', async () => {
    const response = await fetch(
      `${harness.baseUrl}/diaries/${agent.privateDiaryId}/entries/fake-id`,
      { method: 'DELETE' },
    );
    expect(response.status).toBe(401);
  });

  it('POST /diaries/search returns 401 without token', async () => {
    const response = await fetch(`${harness.baseUrl}/diaries/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test', diaryId: agent.privateDiaryId }),
    });
    expect(response.status).toBe(401);
  });

  it('GET /diaries/reflect returns 401 without token', async () => {
    const response = await fetch(
      `${harness.baseUrl}/diaries/reflect?diaryId=${agent.privateDiaryId}`,
    );
    expect(response.status).toBe(401);
  });
});
```

**Step 2: Add cross-agent isolation to diary-search.e2e.test.ts**

Add a new describe block:

```typescript
describe('Cross-agent isolation', () => {
  let agentB: TestAgent;

  beforeAll(async () => {
    const voucherB = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });
    agentB = await createAgent({
      baseUrl: harness.baseUrl,
      identityApi: harness.identityApi,
      hydraAdminOAuth2: harness.hydraAdminOAuth2,
      webhookApiKey: harness.webhookApiKey,
      voucherCode: voucherB,
    });
  });

  it('agentB cannot search agentA diary (403)', async () => {
    const { error } = await searchDiary({
      client,
      auth: () => agentB.accessToken,
      body: { query: 'npm audit', diaryId: agent.privateDiaryId },
    });
    expect(error).toBeDefined();
    // @ts-expect-error error shape
    expect(error.statusCode ?? error.status).toBe(403);
  });

  it('agentB cannot reflect on agentA diary (403)', async () => {
    const response = await fetch(
      `${harness.baseUrl}/diaries/reflect?diaryId=${agent.privateDiaryId}`,
      {
        headers: { authorization: `Bearer ${agentB.accessToken}` },
      },
    );
    expect(response.status).toBe(403);
  });
});
```

**Step 3: Run all unit tests and typecheck**

```bash
pnpm run test && pnpm run typecheck
```

Expected: ALL PASS

**Step 4: Commit Tasks 12-14**

```bash
git add apps/rest-api/e2e/diary-management.e2e.test.ts \
        apps/rest-api/e2e/diary-crud.e2e.test.ts \
        apps/rest-api/e2e/diary-search.e2e.test.ts
git commit -m "test(e2e): add 401 coverage, invitation isolation, and writer/reader Keto model tests"
```

---

## Task 15: Rebuild Keto container and run e2e tests

The OPL change in Task 1 affects the running Keto instance. The e2e stack must be rebuilt to pick it up.

**Step 1: Rebuild the e2e stack**

```bash
docker compose -f docker-compose.e2e.yaml down -v
docker compose -f docker-compose.e2e.yaml up -d --build
```

Expected: all containers start, health checks pass.

**Step 2: Run the full e2e suite**

```bash
pnpm --filter @moltnet/rest-api run test:e2e
```

Expected: ALL PASS — including the new writer/reader Keto model tests in Task 13 which validate the OPL change works end-to-end.

**Step 3: If tests fail**

Check Keto container logs for OPL compilation errors:

```bash
docker compose -f docker-compose.e2e.yaml logs keto
```

Common issue: `traverse` syntax error in OPL → re-check the exact class body written in Task 1.

**Step 4: Final commit**

```bash
git add -p  # review any last tweaks
git commit -m "test(e2e): verify transitive Keto parent model end-to-end"
```

---

## Verification

```bash
# Full quality gate
pnpm run typecheck
pnpm run lint
pnpm run test

# E2E (requires running stack)
docker compose -f docker-compose.e2e.yaml down -v
docker compose -f docker-compose.e2e.yaml up -d --build
pnpm --filter @moltnet/rest-api run test:e2e
```

---

## Files Changed

| File                                                   | Change                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `infra/ory/permissions.ts`                             | Rewrite `DiaryEntry` class: `parent: Diary[]`, transitive permits         |
| `libs/auth/src/keto-constants.ts`                      | Remove `DiaryEntryRelation.Owner/Viewer`, `DiaryEntryPermission.Share`    |
| `libs/auth/src/relationship-writer.ts`                 | Replace `grantOwnership` with `grantEntryParent` (subject_set)            |
| `libs/auth/src/permission-checker.ts`                  | Remove `canShareEntry`                                                    |
| `libs/diary-service/src/types.ts`                      | Remove `requesterId` from `CreateEntryInput`; update `RelationshipWriter` |
| `libs/diary-service/src/diary-service.ts`              | Fix comment; remove `requesterId` from `create()` call                    |
| `libs/diary-service/src/workflows/diary-workflows.ts`  | `grantOwnershipStep` → `grantEntryParentStep(entryId, diaryId)`           |
| `apps/rest-api/src/routes/diary.ts`                    | Remove `requesterId` from create call; fix M3 description                 |
| `libs/auth/__tests__/relationship-writer.test.ts`      | Replace `grantOwnership` tests with `grantEntryParent` (subject_set)      |
| `libs/diary-service/__tests__/diary-workflows.test.ts` | Update mock + assertions                                                  |
| `libs/auth/__tests__/plugin.test.ts`                   | Remove `canShareEntry`; rename `grantOwnership` → `grantEntryParent`      |
| `apps/rest-api/__tests__/diary.test.ts`                | Remove `requesterId` from create assertion                                |
| `apps/rest-api/e2e/diary-management.e2e.test.ts`       | Add 401 tests, invitation isolation, writer/reader Keto model             |
| `apps/rest-api/e2e/diary-crud.e2e.test.ts`             | Add 401 tests for entry CRUD, search, reflect                             |
| `apps/rest-api/e2e/diary-search.e2e.test.ts`           | Add cross-agent isolation tests                                           |
