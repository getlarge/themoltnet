/**
 * E2E Test Helpers
 *
 * Creates real agents through the POST /auth/register DBOS workflow:
 * 1. Generate Ed25519 keypair
 * 2. Register via POST /auth/register (creates Kratos identity, agent record,
 *    Keto relations, personal team, and OAuth2 client in one workflow)
 * 3. Acquire access token via client_credentials
 * 4. Create a moltnet-visibility diary for tests that need embeddings
 *
 * POST /auth/register and POST /oauth2/token are Ory proxy endpoints that
 * are NOT part of the MoltNet OpenAPI spec — they are pass-through to Kratos
 * and Hydra respectively. We call them with raw fetch because there are no
 * generated functions for them.
 */

import { randomBytes } from 'node:crypto';

import { agentVouchers, type Database } from '@moltnet/database';

const BASE_URL = process.env.SERVER_BASE_URL ?? 'http://localhost:8080';

export interface TestAgent {
  identityId: string;
  clientId: string;
  clientSecret: string;
  accessToken: string;
  personalTeamId: string;
}

/**
 * Create a voucher code directly in the database for E2E tests.
 * Bypasses the normal "issue via authenticated agent" flow.
 */
export async function createTestVoucher(opts: {
  db: Database;
  issuerId: string;
}): Promise<string> {
  const code = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await opts.db.insert(agentVouchers).values({
    code,
    issuerId: opts.issuerId,
    expiresAt,
    redeemedAt: null,
    redeemedBy: null,
  });

  return code;
}

/**
 * Create a fully-registered agent via POST /auth/register.
 * The DBOS workflow handles: Kratos identity, agent record, Keto relations,
 * personal team, and OAuth2 client creation.
 */
export async function createAgent(opts: {
  baseUrl: string;
  db: Database;
  bootstrapIdentityId: string;
}): Promise<TestAgent> {
  const { publicKey } = await generateEd25519KeyPair();

  const voucherCode = await createTestVoucher({
    db: opts.db,
    issuerId: opts.bootstrapIdentityId,
  });

  // Register via Ory proxy — NOT in OpenAPI spec
  const regRes = await fetch(`${opts.baseUrl}/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      public_key: publicKey,
      voucher_code: voucherCode,
    }),
  });

  if (!regRes.ok) {
    throw new Error(`Registration failed: ${regRes.status} ${await regRes.text()}`);
  }

  const creds = (await regRes.json()) as {
    identityId: string;
    clientId: string;
    clientSecret: string;
  };

  // Acquire access token via Hydra proxy — NOT in OpenAPI spec
  const tokenRes = await fetch(`${opts.baseUrl}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      scope: 'diary:read diary:write crypto:sign agent:profile',
    }),
  });

  if (!tokenRes.ok) {
    throw new Error(`Token acquisition failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }

  const { access_token } = (await tokenRes.json()) as { access_token: string };

  // Fetch personal team ID
  const teamsRes = await fetch(`${opts.baseUrl}/teams`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!teamsRes.ok) {
    throw new Error(`Teams fetch failed: ${teamsRes.status}`);
  }

  const teamsData = (await teamsRes.json()) as {
    items: Array<{ id: string; personal: boolean }>;
  };
  const personalTeam = teamsData.items.find((t) => t.personal);
  if (!personalTeam) {
    throw new Error('No personal team found after registration');
  }

  return {
    identityId: creds.identityId,
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    accessToken: access_token,
    personalTeamId: personalTeam.id,
  };
}

/**
 * Create a diary scoped to a team.
 */
export async function createDiary(opts: {
  baseUrl: string;
  token: string;
  teamId: string;
  name: string;
  visibility?: 'private' | 'moltnet';
}): Promise<{ id: string; name: string; teamId: string }> {
  const res = await fetch(`${opts.baseUrl}/diaries`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.token}`,
      'x-moltnet-team-id': opts.teamId,
    },
    body: JSON.stringify({
      name: opts.name,
      visibility: opts.visibility ?? 'moltnet',
    }),
  });

  if (!res.ok) {
    throw new Error(`Create diary failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

/**
 * Create a diary entry.
 */
export async function createEntry(opts: {
  baseUrl: string;
  token: string;
  diaryId: string;
  content: string;
  tags?: string[];
}): Promise<{ id: string; content: string }> {
  const res = await fetch(`${opts.baseUrl}/diaries/${opts.diaryId}/entries`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.token}`,
    },
    body: JSON.stringify({
      content: opts.content,
      tags: opts.tags ?? [],
    }),
  });

  if (!res.ok) {
    throw new Error(`Create entry failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

// Stub — in real code this wraps tweetnacl
async function generateEd25519KeyPair() {
  return { publicKey: randomBytes(32).toString('hex') };
}
