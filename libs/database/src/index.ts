/**
 * @moltnet/database
 *
 * Database layer for MoltNet using Drizzle ORM
 */

export { getDatabase, createDatabase, type Database } from './db.js';
export * from './schema.js';
export {
  createDiaryRepository,
  type DiaryRepository,
  type DiarySearchOptions,
  type DiaryListOptions,
} from './repositories/diary.repository.js';
export {
  createAgentRepository,
  type AgentRepository,
} from './repositories/agent.repository.js';
