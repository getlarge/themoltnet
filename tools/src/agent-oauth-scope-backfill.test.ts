import type { OAuth2Client } from '@ory/client-fetch';
import { describe, expect, it, vi } from 'vitest';

import {
  backfillAgentOAuthScopes,
  nextPageToken,
} from './agent-oauth-scope-backfill.js';

const EXPECTED_SCOPE =
  'agent:profile connector:invoke crypto:sign diary:manage diary:read diary:write key:manage pack:read pack:write runtime:manage runtime:read task:claim task:execute task:manage task:read team:manage team:read';

function client(overrides: Partial<OAuth2Client> = {}): OAuth2Client {
  return {
    client_id: 'agent-client',
    metadata: { type: 'moltnet_agent' },
    scope: '',
    ...overrides,
  };
}

function page(clients: OAuth2Client[], link?: string) {
  return {
    raw: new Response(null, { headers: link ? { link } : undefined }),
    value: vi.fn().mockResolvedValue(clients),
  };
}

describe('agent OAuth scope backfill', () => {
  it('extracts the opaque token from Ory Link pagination', () => {
    expect(
      nextPageToken(
        '<https://example.oryapis.com/admin/clients?page_token=opaque-next>; rel="next"',
      ),
    ).toBe('opaque-next');
  });

  it('is a non-mutating dry run and ignores non-agent clients', async () => {
    const api = {
      listOAuth2ClientsRaw: vi
        .fn()
        .mockResolvedValue(
          page([
            client(),
            client({ client_id: 'mcp-client', metadata: { type: 'mcp' } }),
          ]),
        ),
      patchOAuth2Client: vi.fn(),
      getOAuth2Client: vi.fn(),
    };

    const result = await backfillAgentOAuthScopes(api as never, {
      apply: false,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(result).toEqual({
      agentClients: 1,
      changed: 1,
      compliant: 0,
      failed: 0,
    });
    expect(api.patchOAuth2Client).not.toHaveBeenCalled();
  });

  it('updates, verifies, paginates, and is idempotent for compliant clients', async () => {
    const api = {
      listOAuth2ClientsRaw: vi
        .fn()
        .mockResolvedValueOnce(
          page(
            [client()],
            '<https://example.oryapis.com/admin/clients?page_token=next>; rel="next"',
          ),
        )
        .mockResolvedValueOnce(
          page([client({ client_id: 'already-done', scope: EXPECTED_SCOPE })]),
        ),
      patchOAuth2Client: vi.fn().mockResolvedValue(undefined),
      getOAuth2Client: vi
        .fn()
        .mockResolvedValue(client({ scope: EXPECTED_SCOPE })),
    };

    const result = await backfillAgentOAuthScopes(api as never, {
      apply: true,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(result).toEqual({
      agentClients: 2,
      changed: 1,
      compliant: 1,
      failed: 0,
    });
    expect(api.patchOAuth2Client).toHaveBeenCalledWith(
      {
        id: 'agent-client',
        jsonPatch: [{ op: 'add', path: '/scope', value: EXPECTED_SCOPE }],
      },
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(api.listOAuth2ClientsRaw).toHaveBeenLastCalledWith(
      { pageSize: 100, pageToken: 'next' },
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(api.getOAuth2Client).toHaveBeenCalledWith(
      { id: 'agent-client' },
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('processes each page before requesting the next page', async () => {
    const patchOAuth2Client = vi.fn().mockResolvedValue(undefined);
    const listOAuth2ClientsRaw = vi
      .fn()
      .mockResolvedValueOnce(
        page(
          [client()],
          '<https://example.oryapis.com/admin/clients?page_token=next>; rel="next"',
        ),
      )
      .mockImplementationOnce(() => {
        expect(patchOAuth2Client).toHaveBeenCalledTimes(1);
        return Promise.resolve(page([]));
      });
    const api = {
      listOAuth2ClientsRaw,
      patchOAuth2Client,
      getOAuth2Client: vi
        .fn()
        .mockResolvedValue(client({ scope: EXPECTED_SCOPE })),
    };

    await backfillAgentOAuthScopes(api as never, {
      apply: true,
      logger: { info: vi.fn(), error: vi.fn() },
      requestTimeoutMs: 5_000,
    });

    expect(listOAuth2ClientsRaw).toHaveBeenCalledTimes(2);
  });

  it('reports a failed post-update verification', async () => {
    const api = {
      listOAuth2ClientsRaw: vi.fn().mockResolvedValue(page([client()])),
      patchOAuth2Client: vi.fn().mockResolvedValue(undefined),
      getOAuth2Client: vi.fn().mockResolvedValue(client()),
    };

    const result = await backfillAgentOAuthScopes(api as never, {
      apply: true,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(result.failed).toBe(1);
    expect(result.changed).toBe(0);
  });
});
