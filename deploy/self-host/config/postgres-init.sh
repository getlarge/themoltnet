#!/bin/sh
set -eu
# psql imports the password from the environment; it never enters argv.
# Disable statement/error logging before the server builds password-bearing DDL.
if ! psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres > /dev/null 2>&1 <<'SQL'
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
SET log_error_verbosity = 'terse';
SET log_parameter_max_length = 0;
SET log_parameter_max_length_on_error = 0;
\getenv app_password APP_DB_PASSWORD
SELECT set_config('moltnet.provision_password', :'app_password', false) AS ignored \gset
DO $provision$ BEGIN EXECUTE format('CREATE ROLE moltnet LOGIN PASSWORD %L', current_setting('moltnet.provision_password')); END $provision$;
CREATE DATABASE moltnet OWNER moltnet;
REVOKE CONNECT ON DATABASE moltnet FROM PUBLIC;
GRANT CONNECT ON DATABASE moltnet TO moltnet;
SQL
then
  echo 'Application database initialization failed' >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname moltnet <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
SQL
