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
