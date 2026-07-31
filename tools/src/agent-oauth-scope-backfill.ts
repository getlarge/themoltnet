import { AGENT_OAUTH_SCOPES } from '@moltnet/models';
import type { OAuth2Api, OAuth2Client } from '@ory/client-fetch';

type OAuthClientAdminApi = Pick<
  OAuth2Api,
  'getOAuth2Client' | 'listOAuth2ClientsRaw' | 'patchOAuth2Client'
>;

export interface BackfillLogger {
  info: (message: string) => void;
  error: (message: string) => void;
}

export interface AgentOAuthScopeBackfillResult {
  agentClients: number;
  changed: number;
  compliant: number;
  failed: number;
}

const EXPECTED_SCOPE = AGENT_OAUTH_SCOPES.join(' ');

function scopeTokens(scope: string | undefined): string[] {
  return scope?.split(/\s+/u).filter(Boolean) ?? [];
}

function hasExpectedScope(scope: string | undefined): boolean {
  const actual = scopeTokens(scope);
  return (
    actual.length === AGENT_OAUTH_SCOPES.length &&
    new Set(actual).size === actual.length &&
    AGENT_OAUTH_SCOPES.every((candidate) => actual.includes(candidate))
  );
}

function isAgentClient(client: OAuth2Client): boolean {
  const metadata = client.metadata;
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).type === 'moltnet_agent'
  );
}

export function nextPageToken(linkHeader: string | null): string | undefined {
  if (!linkHeader) return undefined;
  for (const link of linkHeader.split(',')) {
    const match = link.match(/<([^>]+)>\s*;\s*rel="?next"?/u);
    if (!match?.[1]) continue;
    const token = new URL(match[1], 'https://ory.invalid').searchParams.get(
      'page_token',
    );
    if (token) return token;
  }
  return undefined;
}

async function listClients(api: OAuthClientAdminApi): Promise<OAuth2Client[]> {
  const clients: OAuth2Client[] = [];
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;
  do {
    const response = await api.listOAuth2ClientsRaw({
      pageSize: 100,
      pageToken,
    });
    clients.push(...(await response.value()));
    const next = nextPageToken(response.raw.headers.get('link'));
    if (next && seenTokens.has(next)) {
      throw new Error(`Ory returned a repeated page token: ${next}`);
    }
    if (next) seenTokens.add(next);
    pageToken = next;
  } while (pageToken);
  return clients;
}

export async function backfillAgentOAuthScopes(
  api: OAuthClientAdminApi,
  options: { apply: boolean; logger: BackfillLogger },
): Promise<AgentOAuthScopeBackfillResult> {
  const clients = (await listClients(api)).filter(isAgentClient);
  const result: AgentOAuthScopeBackfillResult = {
    agentClients: clients.length,
    changed: 0,
    compliant: 0,
    failed: 0,
  };

  for (const client of clients) {
    const clientId = client.client_id;
    if (!clientId) {
      result.failed += 1;
      options.logger.error('Agent OAuth client has no client_id');
      continue;
    }
    if (hasExpectedScope(client.scope)) {
      result.compliant += 1;
      options.logger.info(`compliant ${clientId}`);
      continue;
    }
    if (!options.apply) {
      result.changed += 1;
      options.logger.info(
        `would update ${clientId} (${scopeTokens(client.scope).length} -> ${AGENT_OAUTH_SCOPES.length} scopes)`,
      );
      continue;
    }

    try {
      await api.patchOAuth2Client({
        id: clientId,
        jsonPatch: [{ op: 'add', path: '/scope', value: EXPECTED_SCOPE }],
      });
      const updated = await api.getOAuth2Client({ id: clientId });
      if (!hasExpectedScope(updated.scope)) {
        throw new Error('post-update verification returned unexpected scopes');
      }
      result.changed += 1;
      options.logger.info(`updated and verified ${clientId}`);
    } catch (error) {
      result.failed += 1;
      options.logger.error(
        `failed ${clientId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return result;
}
