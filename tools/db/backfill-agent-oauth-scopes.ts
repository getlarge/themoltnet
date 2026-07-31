/* eslint-disable no-console */
/**
 * Backfill existing MoltNet agent OAuth clients with the canonical scope set.
 *
 * Safe default (read-only):
 *   pnpm exec tsx tools/db/backfill-agent-oauth-scopes.ts
 * Apply and verify every write:
 *   pnpm exec tsx tools/db/backfill-agent-oauth-scopes.ts --apply
 * Deployment gate (exits non-zero if a client still needs changes):
 *   pnpm exec tsx tools/db/backfill-agent-oauth-scopes.ts --verify
 */

import { config } from '@dotenvx/dotenvx';
import { Configuration, OAuth2Api } from '@ory/client-fetch';

import { backfillAgentOAuthScopes } from '../src/agent-oauth-scope-backfill.js';

config({ path: ['env.public', '.env.infra.local'], override: false });

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const verify = args.has('--verify');
if (apply && verify) {
  throw new Error('Choose either --apply or --verify');
}

const basePath = process.env.ORY_HYDRA_ADMIN_URL ?? process.env.ORY_PROJECT_URL;
const accessToken = process.env.ORY_PROJECT_API_KEY ?? process.env.ORY_API_KEY;
if (!basePath || !accessToken) {
  throw new Error(
    'ORY_PROJECT_URL (or ORY_HYDRA_ADMIN_URL) and ORY_PROJECT_API_KEY are required',
  );
}

const api = new OAuth2Api(new Configuration({ basePath, accessToken }));
const result = await backfillAgentOAuthScopes(api, {
  apply,
  logger: { info: console.log, error: console.error },
});

console.log(
  JSON.stringify({
    mode: apply ? 'apply' : verify ? 'verify' : 'dry-run',
    ...result,
  }),
);
if (result.failed > 0 || (verify && result.changed > 0)) process.exitCode = 1;
