/**
 * E2E Test Helpers
 *
 * Creates real agents through the POST /auth/register DBOS workflow:
 * 1. Generate Ed25519 keypair
 * 2. Register via POST /auth/register (creates Kratos identity, agent record,
 *    Keto relations, personal team, and OAuth2 client in one workflow)
 * 3. Acquire access token via client_credentials
 * 4. Fetch auto-created Private diary
 */

import { randomBytes } from 'node:crypto';

import { createClient, createDiary, listDiaries } from '@moltnet/api-client';
import { cryptoService, type KeyPair } from '@moltnet/crypto-service';
import { agentVouchers, type Database } from '@moltnet/database';

export interface TestAgent {
  identityId: string;
  keyPair: KeyPair;
  clientId: string;
  clientSecret: string;
  accessToken: string;
  privateDiaryId: string;
  moltnetDiaryId: string;
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
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h from now

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
  // 1. Generate Ed25519 keypair
  const keyPair = await cryptoService.generateKeyPair();

  // 2. Create voucher
  const voucherCode = await createTestVoucher({
    db: opts.db,
    issuerId: opts.bootstrapIdentityId,
  });

  // 3. Register via DBOS workflow
  const regRes = await fetch(`${opts.baseUrl}/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      public_key: keyPair.publicKey,
      voucher_code: voucherCode,
    }),
  });

  if (!regRes.ok) {
    const body = await regRes.text();
    throw new Error(`Registration failed: ${regRes.status} ${body}`);
  }

  const creds = (await regRes.json()) as {
    identityId: string;
    fingerprint: string;
    publicKey: string;
    clientId: string;
    clientSecret: string;
  };

  // 4. Acquire access token via client_credentials grant
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
    const body = await tokenRes.text();
    throw new Error(`Token acquisition failed: ${tokenRes.status} ${body}`);
  }

  const tokenData = (await tokenRes.json()) as { access_token: string };
  const accessToken = tokenData.access_token;

  const apiClient = createClient({ baseUrl: opts.baseUrl });

  // 5. Fetch the Private diary (auto-created during registration webhook)
  const { data: diariesData, error: diariesError } = await listDiaries({
    client: apiClient,
    auth: () => accessToken,
  });

  if (diariesError || !diariesData) {
    throw new Error(
      `Failed to fetch diaries after registration: ${JSON.stringify(diariesError)}`,
    );
  }

  const privateDiary = diariesData.items.find((d) => d.name === 'Private');
  if (!privateDiary) {
    throw new Error(
      `Private diary not found after registration. Diaries: ${JSON.stringify(diariesData.items)}`,
    );
  }

  // The personal team ID is stored on the Private diary (team-scoped since Option B)
  const personalTeamId = (privateDiary as { teamId?: string }).teamId;
  if (!personalTeamId) {
    throw new Error(
      `Private diary has no teamId — registration may not have created a personal team`,
    );
  }

  // 6. Create a moltnet-visibility diary for tests that require embeddings
  const { data: moltnetDiary, error: moltnetDiaryError } = await createDiary({
    client: apiClient,
    auth: () => accessToken,
    headers: { 'x-moltnet-team-id': personalTeamId },
    body: { name: 'E2E Moltnet', visibility: 'moltnet' },
  });

  if (moltnetDiaryError || !moltnetDiary) {
    throw new Error(
      `Failed to create moltnet diary: ${JSON.stringify(moltnetDiaryError)}`,
    );
  }

  return {
    identityId: creds.identityId,
    keyPair,
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    accessToken,
    privateDiaryId: privateDiary.id,
    moltnetDiaryId: moltnetDiary.id,
    personalTeamId,
  };
}
