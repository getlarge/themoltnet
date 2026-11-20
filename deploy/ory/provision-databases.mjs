import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const databases = ['kratos', 'hydra', 'keto'];
// Serializes this provisioner across connections to the same PostgreSQL server.
const provisioningLock = 684615703;
class ProvisioningError extends Error {}

export function provisioningFailure(error) {
  // Only our fixed messages are safe; driver messages/context can contain SQL
  // and parameters. PostgreSQL SQLSTATE codes have a bounded public format.
  const reason =
    error instanceof ProvisioningError
      ? error.message
      : /^[0-9A-Z]{5}$/.test(error?.code ?? '')
        ? `PostgreSQL SQLSTATE ${error.code}`
        : 'check database connectivity and administrator privileges';
  return `Ory database provisioning failed: ${reason}`;
}

/** Create only Ory roles/databases. Existing ownership and passwords are preserved. */
export async function provisionDatabases(
  client,
  passwords,
  output = console.log,
) {
  // PostgreSQL must not log parameter values or password-bearing dynamic DDL,
  // including on errors. An administrator connection is required for these SETs.
  await client.query(`SET log_statement = 'none'`);
  await client.query(`SET log_min_error_statement = 'panic'`);
  await client.query(`SET log_error_verbosity = 'terse'`);
  await client.query(`SET log_parameter_max_length = 0`);
  await client.query(`SET log_parameter_max_length_on_error = 0`);
  await client.query('SELECT pg_advisory_lock($1)', [provisioningLock]);
  try {
    for (const name of databases) {
      if (!passwords[name])
        throw new ProvisioningError(
          `${name}: required database password missing`,
        );
      const role = await client.query(
        'SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = $1',
        [name],
      );
      if (role.rows.length) {
        const r = role.rows[0];
        if (
          !r.rolcanlogin ||
          r.rolsuper ||
          r.rolcreatedb ||
          r.rolcreaterole ||
          r.rolreplication ||
          r.rolbypassrls
        )
          throw new ProvisioningError(
            `${name}: existing role has unexpected privileges`,
          );
        const membership = await client.query(
          'SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = $1 LIMIT 1',
          [name],
        );
        if (membership.rows.length)
          throw new ProvisioningError(
            `${name}: existing role has unexpected membership`,
          );
      } else {
        // Parameters never become SQL text sent by the client. The DO block
        // executes on the server after statement/parameter logging is disabled.
        await client.query(
          "SELECT set_config('moltnet.provision_password', $1, false)",
          [passwords[name]],
        );
        await client.query(
          `DO $provision$ BEGIN EXECUTE format('CREATE ROLE ${name} LOGIN PASSWORD %L', current_setting('moltnet.provision_password')); END $provision$`,
        );
        await client.query(
          "SELECT set_config('moltnet.provision_password', '', false)",
        );
      }
      const db = await client.query(
        'SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1',
        [name],
      );
      if (db.rows.length && db.rows[0].owner !== name)
        throw new ProvisioningError(
          `${name}: existing database has unexpected ownership`,
        );
      if (!db.rows.length)
        await client.query(`CREATE DATABASE ${name} OWNER ${name}`);
      await client.query(`REVOKE CONNECT ON DATABASE ${name} FROM PUBLIC`);
      await client.query(`GRANT CONNECT ON DATABASE ${name} TO ${name}`);
      output(
        `Verified Ory database ${name}; ${role.rows.length ? 'existing role password unchanged' : 'created login role'}`,
      );
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [provisioningLock]);
  }
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  // The tools image already ships pg. Resolving relative to /app avoids a
  // second installed dependency tree beside a bind-mounted script.
  const { Client } = createRequire('/app/package.json')('pg');
  const client = new Client({
    host: process.env.ORY_DB_HOST ?? 'postgres',
    port: Number(process.env.ORY_DB_PORT ?? 5432),
    user: process.env.ORY_DB_ADMIN_USER ?? 'postgres',
    password: process.env.ORY_DB_ADMIN_PASSWORD,
    database: 'postgres',
    ssl:
      process.env.ORY_DB_SSLMODE === 'verify-full'
        ? { rejectUnauthorized: true }
        : false,
    connectionTimeoutMillis: 10000,
    query_timeout: 30000,
  });
  try {
    if (
      !['disable', 'verify-full'].includes(
        process.env.ORY_DB_SSLMODE ?? 'disable',
      )
    )
      throw new ProvisioningError(
        'unsupported ORY_DB_SSLMODE; use disable or verify-full',
      );
    await client.connect();
    await provisionDatabases(
      client,
      Object.fromEntries(
        databases.map((name) => [
          name,
          process.env[`${name.toUpperCase()}_DB_PASSWORD`],
        ]),
      ),
    );
  } catch (error) {
    console.error(provisioningFailure(error));
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}
