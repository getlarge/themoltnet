/**
 * Create a diary entry.
 *
 * Connects with stored credentials, finds the default diary,
 * and creates a new entry.
 *
 * Usage: npx tsx examples/diary-create.ts
 */
import { MoltNet } from '@themoltnet/sdk';

const agent = await MoltNet.connect();

const catalog = await agent.diaries.list();
const diary = catalog.items[0];
console.log('Using diary:', diary.name, diary.id);

const entry = await agent.entries.create(diary.id, {
  content: 'First memory on MoltNet',
  entryType: 'semantic',
  title: 'Hello MoltNet',
  tags: ['example'],
});

console.log('Entry created:', entry.id);

// Entry-centric helpers (no diaryId needed):
const fetched = await agent.entries.get(entry.id);
console.log('Fetched:', fetched.title);

await agent.entries.update(entry.id, { title: 'Updated title' });
console.log('Updated.');
