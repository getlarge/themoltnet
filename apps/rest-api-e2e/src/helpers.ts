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
import type { FrontendApi } from '@ory/client-fetch';

// ── Polling Helpers ───────────────────────────────────────────────────────────

export interface PollOptions {
  /** Maximum number of attempts before giving up. Default: 20. */
  maxAttempts?: number;
  /** Delay between attempts in milliseconds. Default: 250. */
  intervalMs?: number;
  /**
   * If true (default), throw a descriptive Error on timeout.
   * If false, resolve with the last produced value instead.
   */
  throwOnTimeout?: boolean;
  /** Label used in the timeout error message. */
  label?: string;
}

/**
 * Poll an async producer until its result satisfies `predicate`.
 *
 * Returns the first value matching the predicate. On timeout, throws by default
 * (or returns the last produced value when `throwOnTimeout: false`).
 *
 * Use this for any e2e readiness check that depends on async/eventually-consistent
 * state (DBOS workflows, Keto tuple propagation, search indexing, etc.).
 */
export async function pollUntil<T>(
  produce: () => Promise<T>,
  predicate: (value: T) => boolean,
  options: PollOptions = {},
): Promise<T> {
  const {
    maxAttempts = 20,
    intervalMs = 250,
    throwOnTimeout = true,
    label = 'pollUntil',
  } = options;

  let last: T | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    last = await produce();
    if (predicate(last)) return last;
    await new Promise<void>((r) => {
      setTimeout(r, intervalMs);
    });
  }

  if (throwOnTimeout) {
    throw new Error(
      `${label}: condition not met after ${maxAttempts} attempts (${maxAttempts * intervalMs}ms)`,
    );
  }
  return last as T;
}

/**
 * Specialization of `pollUntil` for api-client calls: polls a request until
 * `response.status` matches `targetStatus` (or any of the provided statuses).
 *
 * Returns the matching `{ data, response, error }` envelope. Throws on timeout
 * unless `throwOnTimeout: false` is passed.
 */
export function pollUntilStatus<R extends { response: { status: number } }>(
  request: () => Promise<R>,
  targetStatus: number | readonly number[],
  options: PollOptions = {},
): Promise<R> {
  const targets = Array.isArray(targetStatus) ? targetStatus : [targetStatus];
  return pollUntil(request, (r) => targets.includes(r.response.status), {
    label: `pollUntilStatus(${targets.join('|')})`,
    ...options,
  });
}

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

// ── Human Registration / Login via Kratos Native Flows ──────

export interface TestHuman {
  identityId: string;
  humanId: string;
  sessionToken: string;
  email: string;
  username: string;
  password: string;
}

/**
 * Register and log in a human via Kratos native self-service flows.
 *
 * 1. Create native registration flow
 * 2. Submit registration (email + username + password)
 *    → after-registration webhook creates human placeholder
 * 3. Create native login flow
 * 4. Submit login (email + password)
 *    → after-login webhook triggers DBOS onboarding workflow
 * 5. Return session token + identity details
 */
export async function createHuman(opts: {
  kratosPublicFrontend: FrontendApi;
}): Promise<TestHuman> {
  const suffix = randomBytes(4).toString('hex');
  const email = `human-${suffix}@e2e.local`;
  const username = `human-${suffix}`;
  const password = `e2e-test-human-password-${randomBytes(8).toString('hex')}`;

  // Step 1: Create native registration flow
  const regFlow =
    await opts.kratosPublicFrontend.createNativeRegistrationFlow();

  // Step 2: Submit registration
  const regResult = await opts.kratosPublicFrontend.updateRegistrationFlow({
    flow: regFlow.id,
    updateRegistrationFlowBody: {
      method: 'password',
      traits: { email, username },
      password,
    },
  });

  const regIdentity = regResult.identity;
  const humanId = (regIdentity.metadata_public as { human_id?: string } | null)
    ?.human_id;
  if (!humanId) {
    throw new Error(
      `Human registration did not produce human_id in metadata_public: ${JSON.stringify(regIdentity.metadata_public)}`,
    );
  }

  // Step 3: Create native login flow
  const loginFlow = await opts.kratosPublicFrontend.createNativeLoginFlow();

  // Step 4: Submit login (triggers after-login webhook → onboarding)
  const loginResult = await opts.kratosPublicFrontend.updateLoginFlow({
    flow: loginFlow.id,
    updateLoginFlowBody: {
      method: 'password',
      identifier: email,
      password,
    },
  });

  const sessionToken = loginResult.session_token;
  if (!sessionToken) {
    throw new Error('Login did not return a session_token (native flow)');
  }

  const identityId = loginResult.session.identity?.id;
  if (!identityId) {
    throw new Error('Login session has no identity');
  }

  return { identityId, humanId, sessionToken, email, username, password };
}
