#!/usr/bin/env node
/**
 * Deploy Ory project configuration, branding, and permissions.
 *
 * 1. Computes identity schema base64 from JSON files
 * 2. Substitutes env vars into project.json → project.resolved.json
 * 3. (--apply) Pushes project config via `ory update project`
 * 4. (--apply) Syncs Account Experience branding via console normalized API
 * 5. (--apply) Pushes OPL permissions via `ory update opl`
 *
 * Usage:
 *   npx @dotenvx/dotenvx run -f env.public -f .env -- node infra/ory/deploy.mjs
 *   npx @dotenvx/dotenvx run -f env.public -f .env -- node infra/ory/deploy.mjs --apply
 *
 * In CI:
 *   DOTENV_PRIVATE_KEY="<key>" npx @dotenvx/dotenvx run -f env.public -f .env -- node infra/ory/deploy.mjs --apply
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apply = process.argv.includes('--apply');

const CONSOLE_API = 'https://api.console.ory.sh';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function env(name, { required = true } = {}) {
  const val = process.env[name];
  if (required && !val) return undefined;
  return val;
}

function log(msg) {
  console.log(msg);
}

function fatal(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function ory(args) {
  // Run from /tmp to prevent the CLI auto-loading the encrypted .env in the
  // repo root. Unset ORY_PROJECT_API_KEY to avoid conflict with workspace key.
  const environ = { ...process.env };
  delete environ.ORY_PROJECT_API_KEY;
  execFileSync('ory', args, { cwd: '/tmp', env: environ, stdio: 'inherit' });
}

// ---------------------------------------------------------------------------
// 1. Compute identity schema base64
// ---------------------------------------------------------------------------

const agentSchemaFile = join(__dirname, 'identity-schema.json');
const humanSchemaFile = join(__dirname, 'human-identity-schema.json');

if (!existsSync(agentSchemaFile))
  fatal(`Agent identity schema not found at ${agentSchemaFile}`);
if (!existsSync(humanSchemaFile))
  fatal(`Human identity schema not found at ${humanSchemaFile}`);

const agentSchemaB64 = readFileSync(agentSchemaFile).toString('base64');
const humanSchemaB64 = readFileSync(humanSchemaFile).toString('base64');

// Make them available for substitution
process.env.IDENTITY_SCHEMA_AGENT_BASE64 = agentSchemaB64;
process.env.IDENTITY_SCHEMA_HUMAN_BASE64 = humanSchemaB64;

// ---------------------------------------------------------------------------
// 2. Validate required env vars
// ---------------------------------------------------------------------------

const TEMPLATE_VARS = [
  'BASE_DOMAIN',
  'LANDING_BASE_URL',
  'CONSOLE_BASE_URL',
  'API_BASE_URL',
  'ORY_PROJECT_URL',
  'OIDC_PAIRWISE_SALT',
  'ORY_ACTION_API_KEY',
  'IDENTITY_SCHEMA_AGENT_BASE64',
  'IDENTITY_SCHEMA_HUMAN_BASE64',
  'SELFSERVICE_OIDC_GITHUB_CLIENT_ID',
  'SELFSERVICE_OIDC_GITHUB_CLIENT_SECRET',
  'SMTP_CONNECTION_URI',
  'SMTP_FROM_ADDRESS',
];

const missing = TEMPLATE_VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
  fatal(
    `Missing environment variables: ${missing.join(', ')}\n\n` +
      `Run this script through dotenvx:\n` +
      `  npx @dotenvx/dotenvx run -f env.public -f .env -- node ${process.argv[1]}`,
  );
}

// ---------------------------------------------------------------------------
// 3. Substitute placeholders in project.json → project.resolved.json
// ---------------------------------------------------------------------------

const templateFile = join(__dirname, 'project.json');
const outputFile = join(__dirname, 'project.resolved.json');

let content = readFileSync(templateFile, 'utf8');
for (const v of TEMPLATE_VARS) {
  content = content.replaceAll('${' + v + '}', process.env[v]);
}
writeFileSync(outputFile, content);

log(`Resolved config written to: ${outputFile}\n`);
log(`  BASE_DOMAIN:      ${process.env.BASE_DOMAIN}`);
log(`  LANDING_BASE_URL: ${process.env.LANDING_BASE_URL}`);
log(`  CONSOLE_BASE_URL: ${process.env.CONSOLE_BASE_URL}`);
log(`  API_BASE_URL:     ${process.env.API_BASE_URL}`);
log(`  OIDC_SALT:        ${process.env.OIDC_PAIRWISE_SALT.slice(0, 8)}...`);
log(`  AGENT_SCHEMA:     ${agentSchemaB64.length} bytes (base64)`);
log(`  HUMAN_SCHEMA:     ${humanSchemaB64.length} bytes (base64)\n`);

if (!apply) {
  log('Dry run — not applying to Ory Network.');
  log(
    `To apply: npx @dotenvx/dotenvx run -f env.public -f .env -- node ${process.argv[1]} --apply`,
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Validate --apply env vars
// ---------------------------------------------------------------------------

const projectId = env('ORY_PROJECT_ID');
const apiKey = env('ORY_WORKSPACE_API_KEY');

if (!projectId) fatal('ORY_PROJECT_ID must be set for --apply');
if (!apiKey) fatal('ORY_WORKSPACE_API_KEY must be set for --apply');

// ---------------------------------------------------------------------------
// 4. Push project config via ory CLI
// ---------------------------------------------------------------------------

log(`Applying project config to Ory project: ${projectId} ...`);
ory(['update', 'project', projectId, '--file', outputFile, '--yes']);
log('Project config applied.\n');

// ---------------------------------------------------------------------------
// 5. Patch OAuth2 fields that `ory update project` silently strips.
//
//    The Network API behind `ory update project` whitelists writes — it
//    accepts the JSON without warning but drops some `services.oauth2.*`
//    fields, including `oauth2.token_hook`. Per Ory's own docs
//    (https://www.ory.com/docs/hydra/guides/claims-at-refresh), the
//    canonical mechanism is `ory patch oauth2-config`, which targets the
//    oauth2 subresource directly and does write these fields.
//
//    We re-apply token_hook here so it lands in live config on every
//    deploy — without this, Hydra issues unenriched access tokens (no
//    `ext.moltnet:identity_id`) and the rest-api 401s on every call.
// ---------------------------------------------------------------------------

const projectForPatch = JSON.parse(readFileSync(outputFile, 'utf8'));
const tokenHook =
  projectForPatch.services?.oauth2?.config?.oauth2?.token_hook;
if (tokenHook?.url) {
  log('Patching OAuth2 token_hook (workaround for `update project` strip) ...');
  const adds = [
    `/oauth2/token_hook/url="${tokenHook.url}"`,
    `/oauth2/token_hook/auth/type="${tokenHook.auth?.type ?? 'api_key'}"`,
  ];
  if (tokenHook.auth?.config) {
    if (tokenHook.auth.config.in)
      adds.push(`/oauth2/token_hook/auth/config/in="${tokenHook.auth.config.in}"`);
    if (tokenHook.auth.config.name)
      adds.push(
        `/oauth2/token_hook/auth/config/name="${tokenHook.auth.config.name}"`,
      );
    if (tokenHook.auth.config.value)
      adds.push(
        `/oauth2/token_hook/auth/config/value="${tokenHook.auth.config.value}"`,
      );
  }
  const args = ['patch', 'oauth2-config', '--project', projectId, '--format', 'json'];
  for (const add of adds) args.push('--add', add);
  ory(args);
  log('OAuth2 token_hook applied.\n');
} else {
  log('No oauth2.token_hook in project.json — skipping patch.\n');
}

// ---------------------------------------------------------------------------
// 6. Sync Account Experience branding
//    The ory CLI ignores theme_variables_dark/light, so we sync them via
//    the console normalized API (JSON Patch + base64-encoded theme JSON).
// ---------------------------------------------------------------------------

const project = JSON.parse(readFileSync(templateFile, 'utf8'));
const axConfig = project.services?.account_experience?.config ?? {};
const darkTheme = axConfig.theme_variables_dark ?? {};
const lightTheme = axConfig.theme_variables_light ?? {};
const darkKeys = Object.keys(darkTheme).length;
const lightKeys = Object.keys(lightTheme).length;

if (darkKeys > 0 || lightKeys > 0) {
  log(
    `Applying Account Experience branding (dark: ${darkKeys} keys, light: ${lightKeys} keys) ...`,
  );

  const projectRes = await fetch(
    `${CONSOLE_API}/normalized/projects/${projectId}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!projectRes.ok) {
    fatal(`Failed to fetch project revision (HTTP ${projectRes.status})`);
  }
  const revisionId = (await projectRes.json()).current_revision.id;

  const ops = [];
  if (darkKeys > 0) {
    ops.push({
      op: 'replace',
      path: '/account_experience_theme_variables_dark',
      value:
        'base64://' + Buffer.from(JSON.stringify(darkTheme)).toString('base64'),
    });
  }
  if (lightKeys > 0) {
    ops.push({
      op: 'replace',
      path: '/account_experience_theme_variables_light',
      value:
        'base64://' +
        Buffer.from(JSON.stringify(lightTheme)).toString('base64'),
    });
  }

  const patchRes = await fetch(
    `${CONSOLE_API}/normalized/projects/${projectId}/revision/${revisionId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(ops),
    },
  );

  if (patchRes.ok) {
    log('Branding applied.\n');
  } else {
    console.error(
      `WARNING: Branding PATCH returned HTTP ${patchRes.status} — theme may not be updated.`,
    );
  }
} else {
  log('No theme variables to deploy — skipping branding.\n');
}

// ---------------------------------------------------------------------------
// 7. Push OPL permissions
// ---------------------------------------------------------------------------

const oplFile = join(__dirname, 'permissions.ts');
if (existsSync(oplFile)) {
  log('Applying OPL permissions ...');
  ory(['update', 'opl', '--project', projectId, '--file', oplFile]);
  log('OPL permissions applied.\n');
} else {
  console.error(`WARNING: OPL file not found at ${oplFile} — skipping.`);
}

log('Done.');
