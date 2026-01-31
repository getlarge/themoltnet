/**
 * MoltNet Database Client
 *
 * Drizzle ORM connection to Supabase PostgreSQL
 * Lazy initialization — no connection created until first use
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema.js';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Create a new Drizzle database instance from a connection string.
 * Useful for tests and explicit lifecycle management.
 */
export function createDatabase(url: string): Database {
  const client = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return drizzle(client, { schema });
}

// Lazy singleton for production use
let _db: Database | null = null;

/**
 * Get the shared database instance (lazy-initialized singleton).
 * The first call must provide a URL; subsequent calls reuse the singleton.
 */
export function getDatabase(url?: string): Database {
  if (!_db) {
    if (!url) {
      throw new Error(
        'DATABASE_URL must be provided on first call to getDatabase()',
      );
    }
    _db = createDatabase(url);
  }
  return _db;
}

// Re-export schema for external use
export * from './schema.js';
