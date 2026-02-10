/* eslint-disable no-console, no-restricted-syntax */
/**
 * CLI entry point for running database migrations.
 *
 * Usage:
 *   DATABASE_URL=... node dist/migrate-cli.js
 *   DATABASE_URL=... tsx src/migrate-cli.ts
 */

import { runMigrations } from './migrate.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

console.log('Running database migrations...');

runMigrations(databaseUrl)
  .then(() => {
    console.log('Migrations completed successfully');
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
