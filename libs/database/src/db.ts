/**
 * MoltNet Database Client
 * 
 * Drizzle ORM connection to Supabase PostgreSQL
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

// Environment variable for database URL
// Format: postgresql://postgres:[PASSWORD]@db.dlvifjrhhivjwfkivjgr.supabase.co:5432/postgres
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Create postgres.js client
// For Supabase, we use the connection pooler for better performance
const client = postgres(DATABASE_URL, {
  max: 10, // Maximum connections in pool
  idle_timeout: 20, // Close idle connections after 20 seconds
  connect_timeout: 10, // Connection timeout in seconds
});

// Create Drizzle instance with schema
export const db = drizzle(client, { schema });

// Export schema for external use
export * from './schema.js';

// Export types
export type Database = typeof db;
