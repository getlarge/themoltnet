/**
 * E2E: OIDC discovery advertises the MoltNet token proxy
 *
 * The whole point of webfinger.oidc_discovery.token_url (issue #1860) is that
 * a client doing standards-correct discovery lands on our proxy and its cache
 * rather than on Hydra directly. Nothing else in the suite reads the discovery
 * document, so without this the flip could silently regress — Hydra would go
 * back to advertising itself and every third-party client would bypass the
 * cache, with no test failing.
 *
 * These assert the advertised *value*; they deliberately do not follow it,
 * because the local document expresses in-network hosts (http://rest-api:8080)
 * to match URLS_SELF_ISSUER, which the host cannot resolve.
 */

import { describe, expect, it } from 'vitest';

import { HYDRA_PUBLIC_URL } from './setup.js';

interface DiscoveryDocument {
  issuer?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
  token_endpoint_auth_methods_supported?: string[];
}

async function fetchDiscovery(path: string): Promise<DiscoveryDocument> {
  const res = await fetch(`${HYDRA_PUBLIC_URL}${path}`);
  expect(res.status).toBe(200);
  return (await res.json()) as DiscoveryDocument;
}

describe('OIDC discovery', () => {
  it('advertises the MoltNet proxy as the token endpoint', async () => {
    // Act
    const doc = await fetchDiscovery('/.well-known/openid-configuration');

    // Assert — our proxy, not Hydra's own endpoint
    expect(doc.token_endpoint).toBe('http://rest-api:8080/oauth2/token');
  });

  it('advertises the same token endpoint on the RFC 8414 surface', async () => {
    // MCP clients read /.well-known/oauth-authorization-server, not the OIDC
    // document. It was never verified that Hydra applies the webfinger
    // override to both, and a client reading only this one bypassing the
    // proxy is exactly the regression that would go unnoticed.
    const doc = await fetchDiscovery('/.well-known/oauth-authorization-server');

    // Assert
    expect(doc.token_endpoint).toBe('http://rest-api:8080/oauth2/token');
  });

  it('routes registration through the MCP server, not Hydra directly', async () => {
    // Act
    const doc = await fetchDiscovery('/.well-known/openid-configuration');

    // Assert — DCR must reach the sanitising proxy, which strips
    // client-supplied token lifespans before they reach Hydra. Advertising
    // Hydra's own /oauth2/register would bypass that entirely.
    expect(doc.registration_endpoint).toBe(
      'http://mcp-server:8001/oauth/register',
    );
    // The token endpoint is a different service again — registration and
    // token issuance are not the same proxy.
    expect(doc.registration_endpoint).not.toContain('rest-api:8080');
    expect(doc.issuer).toBeTruthy();
  });

  it('advertises client auth methods the proxy actually forwards', async () => {
    // client_secret_basic and private_key_jwt put the client identity in the
    // Authorization header. The proxy used to drop that header, which would
    // have broken every client using them the moment discovery pointed here.
    const doc = await fetchDiscovery('/.well-known/openid-configuration');

    // Assert
    expect(doc.token_endpoint_auth_methods_supported).toContain(
      'client_secret_basic',
    );
    expect(doc.token_endpoint_auth_methods_supported).toContain(
      'client_secret_post',
    );
  });
});
