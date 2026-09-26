#!/bin/sh
set -eu

# Passwords are passed as psql variables so their contents are SQL-quoted.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v app_password="$APP_DB_PASSWORD" \
  -v kratos_password="$KRATOS_DB_PASSWORD" \
  -v hydra_password="$HYDRA_DB_PASSWORD" \
  -v keto_password="$KETO_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE moltnet LOGIN PASSWORD %L', :'app_password') \gexec
SELECT format('CREATE ROLE kratos LOGIN PASSWORD %L', :'kratos_password') \gexec
SELECT format('CREATE ROLE hydra LOGIN PASSWORD %L', :'hydra_password') \gexec
SELECT format('CREATE ROLE keto LOGIN PASSWORD %L', :'keto_password') \gexec
CREATE DATABASE moltnet OWNER moltnet;
CREATE DATABASE kratos OWNER kratos;
CREATE DATABASE hydra OWNER hydra;
CREATE DATABASE keto OWNER keto;
REVOKE CONNECT ON DATABASE moltnet, kratos, hydra, keto FROM PUBLIC;
GRANT CONNECT ON DATABASE moltnet TO moltnet;
GRANT CONNECT ON DATABASE kratos TO kratos;
GRANT CONNECT ON DATABASE hydra TO hydra;
GRANT CONNECT ON DATABASE keto TO keto;
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname moltnet <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
SQL
