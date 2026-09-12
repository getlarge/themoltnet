/**
 * Backfill OAuth2 client scopes for first-party agent clients.
 *
 * Hydra refuses a client_credentials request with `invalid_scope` for any
 * scope the client's own registration lacks. Registration grants
 * `AGENT_OAUTH_SCOPES` at creation time, so every time a credential scope is
 * added to that list, clients registered before the addition can no longer
 * mint a token with the current CLI or SDK, which request the full list.
 *
 * This script lists every Hydra client, keeps the ones registered by MoltNet
 * for an agent (`metadata.type === 'moltnet_agent'`), and appends the missing
 * scopes with a JSON patch on `/scope`. PATCH never touches the client secret.
 * Self-registered (DCR) clients are left alone: their grant is capped on
 * purpose (see `DCR_MAX_SCOPES`).
 *
 * Usage (from the repo root; dotenvx decrypts the infra env and supplies
 * ORY_PROJECT_URL from env.public):
 *
 *   npx dotenvx run --env-file env.public --env-file .env.infra.local -- \
 *     pnpm --filter @moltnet/tools exec tsx src/oauth-client-scope-backfill.ts [--apply|--verify]
 *
 * Default mode is dry-run: it prints what would change and writes nothing.
 */
import { AGENT_OAUTH_SCOPES } from '@moltnet/models';
import { Configuration, OAuth2Api } from '@ory/client-fetch';

export interface OAuth2ClientRecord {
  client_id?: string;
  client_name?: string;
  scope?: string;
  metadata?: unknown;
}

export interface OAuthClientScopeBackfillAdapters {
  listClients(input: {
    pageToken?: string;
  }): Promise<{ items: OAuth2ClientRecord[]; nextPageToken?: string }>;
  setClientScope(clientId: string, scope: string): Promise<void>;
  onProgress?(progress: { completed: number; total: number }): void;
}

export type BackfillMode = 'dry-run' | 'apply' | 'verify';

export interface OAuthClientScopeBackfillPlan {
  clientId: string;
  clientName?: string;
  missing: string[];
  scope: string;
}

export interface OAuthClientScopeBackfillResult {
  mode: BackfillMode;
  scanned: number;
  agentClients: number;
  planned: OAuthClientScopeBackfillPlan[];
  applied: number;
}

function isAgentClient(client: OAuth2ClientRecord): boolean {
  const metadata = client.metadata;
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    (metadata as { type?: unknown }).type === 'moltnet_agent'
  );
}

/** Missing scopes, in canonical order, appended after what the client has. */
export function planClientScope(
  client: OAuth2ClientRecord,
  expected: readonly string[],
): OAuthClientScopeBackfillPlan | null {
  const clientId = client.client_id;
  if (!clientId) return null;
  const current = (client.scope ?? '')
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  const have = new Set(current);
  const missing = expected.filter((scope) => !have.has(scope));
  if (missing.length === 0) return null;
  return {
    clientId,
    clientName: client.client_name,
    missing,
    scope: [...current, ...missing].join(' '),
  };
}

export async function backfillOAuthClientScopes(
  adapters: OAuthClientScopeBackfillAdapters,
  mode: BackfillMode,
  expected: readonly string[] = AGENT_OAUTH_SCOPES,
  options: { paceMs?: number } = {},
): Promise<OAuthClientScopeBackfillResult> {
  const clients: OAuth2ClientRecord[] = [];
  let pageToken: string | undefined;
  do {
    const page = await adapters.listClients({ pageToken });
    clients.push(...page.items);
    pageToken = page.nextPageToken;
  } while (pageToken);

  const agentClients = clients.filter(isAgentClient);
  const planned = agentClients
    .map((client) => planClientScope(client, expected))
    .filter((plan): plan is OAuthClientScopeBackfillPlan => plan !== null);

  if (mode === 'verify' && planned.length > 0) {
    throw new Error(
      `${planned.length} agent client(s) still lack scopes: ${planned
        .map((plan) => `${plan.clientId} (${plan.missing.join(', ')})`)
        .join('; ')}`,
    );
  }

  let applied = 0;
  if (mode === 'apply') {
    for (const plan of planned) {
      await adapters.setClientScope(plan.clientId, plan.scope);
      applied += 1;
      adapters.onProgress?.({ completed: applied, total: planned.length });
      if (options.paceMs && applied < planned.length) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, options.paceMs);
        });
      }
    }
  }

  return {
    mode,
    scanned: clients.length,
    agentClients: agentClients.length,
    planned,
    applied,
  };
}

/** Extract `page_token` from the `rel="next"` entry of a Link header. */
export function nextPageTokenFromLink(link: string | null): string | undefined {
  if (!link) return undefined;
  for (const part of link.split(',')) {
    if (!/rel="next"/.test(part)) continue;
    const match = part.match(/[?&]page_token=([^&>]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return undefined;
}

// ── CLI entry ────────────────────────────────────────────────────────────────

function parseMode(argv: readonly string[]): BackfillMode {
  if (argv.includes('--apply')) return 'apply';
  if (argv.includes('--verify')) return 'verify';
  return 'dry-run';
}

async function main(): Promise<void> {
  const oryProjectUrl = process.env.ORY_PROJECT_URL;
  const oryApiKey = process.env.ORY_PROJECT_API_KEY;
  if (!oryProjectUrl) throw new Error('ORY_PROJECT_URL not set');
  if (!oryApiKey || oryApiKey.startsWith('encrypted:')) {
    throw new Error(
      'ORY_PROJECT_API_KEY not set or still encrypted - run through dotenvx with .env.infra.local',
    );
  }

  const api = new OAuth2Api(
    new Configuration({ basePath: oryProjectUrl, accessToken: oryApiKey }),
  );
  const pageSize = 250;
  const mode = parseMode(process.argv.slice(2));

  const result = await backfillOAuthClientScopes(
    {
      async listClients({ pageToken }) {
        // Hydra uses keyset pagination: the next page_token only exists in
        // the Link header, which the typed method discards.
        const response = await api.listOAuth2ClientsRaw({
          pageSize,
          ...(pageToken ? { pageToken } : {}),
        });
        const items = await response.value();
        return {
          items,
          nextPageToken: nextPageTokenFromLink(
            response.raw.headers.get('link'),
          ),
        };
      },
      async setClientScope(clientId, scope) {
        await api.patchOAuth2Client({
          id: clientId,
          jsonPatch: [{ op: 'replace', path: '/scope', value: scope }],
        });
      },
      onProgress({ completed, total }) {
        console.error(`updated ${completed}/${total}`);
      },
    },
    mode,
    AGENT_OAUTH_SCOPES,
    { paceMs: 100 },
  );

  console.log(
    JSON.stringify(
      {
        mode: result.mode,
        scanned: result.scanned,
        agentClients: result.agentClients,
        needingUpdate: result.planned.length,
        applied: result.applied,
        clients: result.planned.map((plan) => ({
          clientId: plan.clientId,
          clientName: plan.clientName,
          missing: plan.missing,
        })),
      },
      null,
      2,
    ),
  );
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
