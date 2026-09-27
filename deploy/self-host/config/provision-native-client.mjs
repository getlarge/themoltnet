import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const endpoint = 'http://hydra:4445/admin/clients';
const timeoutMs = 10_000;

async function fetchHydra(fetchClient, url, options = {}) {
  return fetchClient(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function lookup(fetchClient, clientId) {
  const url = `${endpoint}/${encodeURIComponent(clientId)}`;
  const response = await fetchHydra(fetchClient, url);
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`Hydra client lookup failed: ${response.status}`);
  return response.json();
}

function verifyClient(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    const current = actual[key];
    const matches = Array.isArray(value)
      ? JSON.stringify([...(current ?? [])].sort()) ===
        JSON.stringify([...value].sort())
      : key === 'authorization_code_grant_access_token_lifespan'
        ? ['5m', '5m0s', '300s'].includes(current)
        : current === value;
    if (!matches)
      throw new Error(
        `Hydra ${expected.client_id} client policy differs: ${key}`,
      );
  }
}

/** Reconcile the local native client and optionally create the OIDC client. */
export async function provisionClients({
  fetchClient = fetch,
  readFile = readFileSync,
  secret = process.env.TAILSCALE_LOGIN_CLIENT_SECRET,
  output = (line) => process.stdout.write(line),
} = {}) {
  const nativeClient = JSON.parse(
    readFile('/etc/config/hydra/moltnet-native.json', 'utf8'),
  );
  const nativeUrl = `${endpoint}/${encodeURIComponent(nativeClient.client_id)}`;
  const nativeExisting = await lookup(fetchClient, nativeClient.client_id);
  const nativeResponse = await fetchHydra(
    fetchClient,
    nativeExisting ? nativeUrl : endpoint,
    {
      method: nativeExisting ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(nativeClient),
    },
  );
  if (!nativeResponse.ok)
    throw new Error(`Hydra client request failed: ${nativeResponse.status}`);
  const nativeResult = await nativeResponse.json();
  if (nativeResult.client_id !== nativeClient.client_id)
    throw new Error('Hydra returned an unexpected native client ID');
  output(`Provisioned ${nativeClient.client_id}\n`);

  if (!secret) return;
  const oidcClient = JSON.parse(
    readFile('/etc/config/hydra/tailscale-login.json', 'utf8'),
  );
  let registered = await lookup(fetchClient, oidcClient.client_id);
  if (!registered) {
    const response = await fetchHydra(fetchClient, endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...oidcClient, client_secret: secret }),
    });
    if (response.status !== 409 && !response.ok)
      throw new Error(`Hydra client request failed: ${response.status}`);
    registered = await lookup(fetchClient, oidcClient.client_id);
    if (!registered)
      throw new Error('Hydra did not return the created OIDC client');
    verifyClient(registered, oidcClient);
    output(
      `${response.status === 409 ? 'Verified existing' : 'Created'} ${oidcClient.client_id}${response.status === 409 ? ' (secret unchanged)' : ''}\n`,
    );
    return;
  }
  verifyClient(registered, oidcClient);
  output(`Verified existing ${oidcClient.client_id} (secret unchanged)\n`);
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await provisionClients();
}
