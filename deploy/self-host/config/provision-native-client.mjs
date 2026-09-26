import { readFileSync } from 'node:fs';

const desired = JSON.parse(
  readFileSync('/etc/config/hydra/moltnet-native.json', 'utf8'),
);
const endpoint = 'http://hydra:4445/admin/clients';
const clientUrl = `${endpoint}/${encodeURIComponent(desired.client_id)}`;

async function request(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Hydra client request failed: ${response.status}`);
  }
  return response.json();
}

const existing = await fetch(clientUrl);
if (existing.status !== 404 && !existing.ok) {
  throw new Error(`Hydra client lookup failed: ${existing.status}`);
}

const client = await request(existing.status === 404 ? endpoint : clientUrl, {
  method: existing.status === 404 ? 'POST' : 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(desired),
});
if (client.client_id !== desired.client_id) {
  throw new Error('Hydra returned an unexpected native client ID');
}
process.stdout.write(`Provisioned ${client.client_id}\n`);

const tailscaleSecret = process.env.TAILSCALE_LOGIN_CLIENT_SECRET;
if (tailscaleSecret) {
  const oidcClient = JSON.parse(
    readFileSync('/etc/config/hydra/tailscale-login.json', 'utf8'),
  );
  const oidcUrl = `${endpoint}/${encodeURIComponent(oidcClient.client_id)}`;
  const registered = await fetch(oidcUrl);
  if (registered.status !== 404 && !registered.ok) {
    throw new Error(`Hydra client lookup failed: ${registered.status}`);
  }
  if (registered.status === 404) {
    await request(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...oidcClient, client_secret: tailscaleSecret }),
    });
  } else {
    const current = await registered.json();
    for (const [key, value] of Object.entries(oidcClient)) {
      const actual = Array.isArray(value) ? (current[key] ?? []) : current[key];
      const matches =
        key === 'authorization_code_grant_access_token_lifespan'
          ? /^5m(?:0s)?$/.test(actual)
          : JSON.stringify(actual) === JSON.stringify(value);
      if (!matches) {
        throw new Error(`Hydra ${oidcClient.client_id} client policy differs`);
      }
    }
  }
  process.stdout.write(`Provisioned ${oidcClient.client_id}\n`);
}
