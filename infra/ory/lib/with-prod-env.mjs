/**
 * Re-exec a command with production database credentials in its environment.
 *
 * Invoked by `infra/ory/with-prod-env.sh` after dotenvx has decrypted the infra
 * env. Kept as a file rather than `node -e` so a non-zero exit prints the
 * child's own error instead of twenty lines of inlined source — during a
 * maintenance window the failure message is the thing you need to read.
 */
import { spawnSync } from 'node:child_process';

const raw = process.env.DATABASE_URL;
if (!raw || raw.startsWith('encrypted:')) {
  console.error('FATAL: DATABASE_URL did not decrypt. Is .env.keys present?');
  process.exit(1);
}

const url = new URL(raw);
url.hostname = '127.0.0.1';
url.port = process.env.MOLTNET_PROXY_PORT ?? '15432';
url.searchParams.set('sslmode', 'disable');

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd) {
  console.error('FATAL: no command given.');
  process.exit(64);
}

// Both forms, deliberately. The Node scripts read DATABASE_URL and translate it
// themselves; psql and every other libpq client ignore DATABASE_URL entirely
// and read PG* — without these a bare psql falls back to a local socket.
const result = spawnSync(cmd, rest, {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: url.toString(),
    PGHOST: url.hostname,
    PGPORT: url.port,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.replace(/^\//, ''),
    PGSSLMODE: url.searchParams.get('sslmode') ?? 'disable',
  },
});

if (result.error) {
  console.error(`FATAL: could not run ${cmd}: ${result.error.message}`);
  process.exit(127);
}
if (result.signal) {
  console.error(`FATAL: ${cmd} killed by ${result.signal}`);
  process.exit(128);
}

// psql exit 2 is a connection failure. It is the likely one here and its own
// message goes to stderr above, so add only what psql cannot know: that the
// tunnel is the usual cause.
if (cmd === 'psql' && result.status === 2) {
  console.error(
    `\nHint: psql could not connect via 127.0.0.1:${url.port}. ` +
      'Check the `flyctl mpg proxy` terminal is still running — it drops ' +
      'silently on network changes and VPN toggles.',
  );
}

process.exit(result.status ?? 1);
