import { runMigrations } from '@moltnet/database';

// eslint-disable-next-line no-restricted-syntax -- standalone script, no config module
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
