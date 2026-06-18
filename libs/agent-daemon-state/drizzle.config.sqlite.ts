import { defineConfig } from 'drizzle-kit';

/**
 * SQLite (node:sqlite via drizzle sqlite-proxy) baseline for the local daemon
 * state DB. `generate` derives DDL from `schema.ts` and needs no live
 * connection. Migrations are applied synchronously at registry open by reading
 * the generated SQL (see `src/migrate.ts`), not via `drizzle-kit migrate`,
 * because the runtime driver is a proxy and the store constructor is sync.
 */
export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle-sqlite',
  dialect: 'sqlite',
  verbose: true,
  strict: true,
});
