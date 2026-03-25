# Add a bulk update method to an existing Drizzle repository

## Problem

The MoltNet diary entries repository needs a new `updateImportance` method that sets the `importance` field for a batch of entries by their IDs. The method receives a list of entry UUIDs and a new importance value (1-10).

The repository follows the factory function pattern used throughout `@moltnet/database`. Here is the existing repository skeleton:

```typescript
import { eq, inArray } from 'drizzle-orm';
import { getTableColumns } from 'drizzle-orm';
import { getExecutor } from '@moltnet/database';
import { diaryEntries } from './schema';
import type { Database } from './types';

export function createDiaryEntryRepository(db: Database) {
  const { embedding: _embedding, ...publicColumns } =
    getTableColumns(diaryEntries);

  return {
    async findById(id: string) {
      const [entry] = await db
        .select(publicColumns)
        .from(diaryEntries)
        .where(eq(diaryEntries.id, id))
        .limit(1);
      return entry ?? null;
    },
    // ADD updateImportance HERE
  };
}
```

## Output

Produce a file `update-importance.ts` containing the `updateImportance` method implementation that could be added to the repository above. The method should:

1. Accept `ids: string[]` and `importance: number`
2. Update all matching entries in one query
3. Return the count of updated rows

Also produce `notes.md` explaining your implementation choice.
