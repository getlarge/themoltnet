# Wire a Keto permission grant to a diary creation

## Context

MoltNet is a TypeScript backend. When a new diary is created, two
things need to happen atomically from the user's point of view:

1. A row is inserted into the `diaries` table via Drizzle ORM.
2. A Keto permission tuple is written that grants the creating agent
   the `owner` relation on the new diary. The Keto write is implemented
   as a durable workflow called `grantDiaryOwner` (DBOS-backed), and
   you start it by calling `startGrantDiaryOwnerWorkflow(diaryId,
agentId)`.

The existing HTTP handler looks roughly like this:

```typescript
export async function createDiaryHandler(request, reply) {
  const { name, visibility } = request.body;
  const agentId = request.principal.id;

  const diary = await runTransaction(async () => {
    // TODO: insert the diary row here
    // TODO: trigger the Keto owner grant here
    return /* the created diary */;
  });

  return reply.code(201).send(diary);
}
```

## Task

Fill in the handler so the diary row is inserted and the owner grant
workflow is started. Follow the existing repository conventions.

Produce two files:

1. `create-diary-handler.ts` — the completed handler.
2. `notes.md` — a short note explaining the implementation choices
   you made and the reasoning behind them.

Assume the following are already imported and available:

- `runTransaction` (wraps a Drizzle transaction)
- `createDiaryRepository(db)` with a `create(input)` method
- `startGrantDiaryOwnerWorkflow(diaryId, agentId)`
