import { defineConfig } from 'drizzle-kit';

/**
 * Postgres baseline for the daemon state DB (used when the daemon points at a
 * shared Postgres instead of a local SQLite file). Applied at registry open via
 * the standard `node-postgres` migrator (see `src/migrate.ts`).
 */
export default defineConfig({
  schema: './src/pg-schema.ts',
  out: './drizzle-pg',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DAEMON_STATE_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
});
