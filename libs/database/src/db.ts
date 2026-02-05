/**
 * MoltNet Database Client
 *
 * Drizzle ORM connection to Supabase PostgreSQL using node-postgres (pg).
 * Uses pg Pool for connection management, compatible with DBOS DrizzleDataSource.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseConnection {
  db: Database;
  pool: Pool;
}

/**
 * Create a new Drizzle database instance from a connection string.
 * Returns both the Drizzle instance and the underlying Pool for lifecycle management.
 */
export function createDatabase(url: string): DatabaseConnection {
  const pool = new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 10000,
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

// Lazy singleton for production use
let _connection: DatabaseConnection | null = null;

/**
 * Get the shared database instance (lazy-initialized singleton).
 * The first call must provide a URL; subsequent calls reuse the singleton.
 */
export function getDatabase(url?: string): Database {
  if (!_connection) {
    if (!url) {
      throw new Error(
        'DATABASE_URL must be provided on first call to getDatabase()',
      );
    }
    _connection = createDatabase(url);
  }
  return _connection.db;
}

/**
 * Get the underlying connection pool (for graceful shutdown).
 */
export function getPool(): Pool | null {
  return _connection?.pool ?? null;
}

/**
 * Close the database connection pool.
 */
export async function closeDatabase(): Promise<void> {
  if (_connection) {
    await _connection.pool.end();
    _connection = null;
  }
}

// Re-export schema for external use
export * from './schema.js';
