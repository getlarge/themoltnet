# SDK Connect + Token Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `MoltNet.connect()` to the SDK that reads credentials, manages OAuth2 tokens, and exposes all API operations via a namespaced `Agent` facade.

**Architecture:** Three new modules (`token.ts`, `connect.ts`, `agent.ts`) in `libs/sdk/src/`. The `TokenManager` handles OAuth2 client_credentials flow with caching and 401 retry. The `connect()` factory resolves credentials (explicit > env > config file) and creates an `Agent` instance. The `Agent` facade groups api-client flat functions by OpenAPI tags (`diary`, `agents`, `crypto`, `vouch`, `auth`, `recovery`, `public`).

**Tech Stack:** TypeScript, `@moltnet/api-client` (auto-generated hey-api client), `@hey-api/client-fetch`, vitest

**Design doc:** `docs/plans/2026-02-17-sdk-connect-token-management-design.md`

---

### Task 1: Add `AuthenticationError` to errors

**Files:**

- Modify: `libs/sdk/src/errors.ts`
- Modify: `libs/sdk/__tests__/errors.test.ts`

**Step 1: Write the failing test**

In `libs/sdk/__tests__/errors.test.ts`, add a test for the new `AuthenticationError`:

```typescript
import { AuthenticationError } from '../src/errors.js';

describe('AuthenticationError', () => {
  it('should have name AuthenticationError and code AUTH_FAILED', () => {
    const err = new AuthenticationError('Invalid credentials');
    expect(err).toBeInstanceOf(MoltNetError);
    expect(err.name).toBe('AuthenticationError');
    expect(err.code).toBe('AUTH_FAILED');
    expect(err.message).toBe('Invalid credentials');
  });

  it('should include detail and statusCode', () => {
    const err = new AuthenticationError('Token expired', {
      statusCode: 401,
      detail: 'The access token has expired',
    });
    expect(err.statusCode).toBe(401);
    expect(err.detail).toBe('The access token has expired');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @themoltnet/sdk test -- --run __tests__/errors.test.ts`
Expected: FAIL — `AuthenticationError` not exported

**Step 3: Write minimal implementation**

In `libs/sdk/src/errors.ts`, add after `NetworkError`:

```typescript
export class AuthenticationError extends MoltNetError {
  constructor(
    message: string,
    options?: { statusCode?: number; detail?: string },
  ) {
    super(message, {
      code: 'AUTH_FAILED',
      statusCode: options?.statusCode,
      detail: options?.detail,
    });
    this.name = 'AuthenticationError';
  }
}
```

Export from `libs/sdk/src/index.ts`:

```typescript
export {
  AuthenticationError,
  MoltNetError,
  NetworkError,
  problemToError,
  RegistrationError,
} from './errors.js';
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @themoltnet/sdk test -- --run __tests__/errors.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add libs/sdk/src/errors.ts libs/sdk/__tests__/errors.test.ts libs/sdk/src/index.ts
git commit -m "feat(sdk): add AuthenticationError class"
```

---

### Task 2: Implement `TokenManager`

**Files:**

- Create: `libs/sdk/src/token.ts`
- Create: `libs/sdk/__tests__/token.test.ts`

**Context:** The `/oauth2/token` endpoint accepts `application/x-www-form-urlencoded` with `grant_type=client_credentials`, `client_id`, `client_secret`. The generated `getOAuth2Token` type has `body?: never` (OpenAPI doesn't describe the form body), so the token manager uses `fetch` directly against the API URL.

**Step 1: Write the failing tests**

Create `libs/sdk/__tests__/token.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthenticationError, NetworkError } from '../src/errors.js';
import { TokenManager } from '../src/token.js';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function tokenResponse(access_token: string, expires_in: number, status = 200) {
  return new Response(
    JSON.stringify({ access_token, token_type: 'bearer', expires_in }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

function errorResponse(error: string, status: number) {
  return new Response(JSON.stringify({ error, error_description: error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('TokenManager', () => {
  const opts = {
    clientId: 'test-client',
    clientSecret: 'test-secret',
    apiUrl: 'https://api.themolt.net',
  };

  it('should obtain a token on first getToken() call', async () => {
    mockFetch.mockResolvedValueOnce(tokenResponse('tok-1', 3600));
    const tm = new TokenManager(opts);
    const token = await tm.getToken();
    expect(token).toBe('tok-1');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('should cache the token on subsequent calls', async () => {
    mockFetch.mockResolvedValueOnce(tokenResponse('tok-1', 3600));
    const tm = new TokenManager(opts);
    await tm.getToken();
    await tm.getToken();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('should re-fetch when token is expired', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse('tok-1', 0))
      .mockResolvedValueOnce(tokenResponse('tok-2', 3600));
    const tm = new TokenManager({ ...opts, expiryBufferMs: 0 });
    await tm.getToken();
    const token = await tm.getToken();
    expect(token).toBe('tok-2');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should send form-encoded client_credentials request', async () => {
    mockFetch.mockResolvedValueOnce(tokenResponse('tok-1', 3600));
    const tm = new TokenManager(opts);
    await tm.getToken();

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.themolt.net/oauth2/token');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const body = new URLSearchParams(init.body);
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe('test-client');
    expect(body.get('client_secret')).toBe('test-secret');
  });

  it('should throw AuthenticationError on 401', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse('invalid_client', 401));
    const tm = new TokenManager(opts);
    await expect(tm.getToken()).rejects.toThrow(AuthenticationError);
  });

  it('should throw NetworkError on fetch failure', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
    const tm = new TokenManager(opts);
    await expect(tm.getToken()).rejects.toThrow(NetworkError);
  });

  it('should invalidate cached token', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse('tok-1', 3600))
      .mockResolvedValueOnce(tokenResponse('tok-2', 3600));
    const tm = new TokenManager(opts);
    await tm.getToken();
    tm.invalidate();
    const token = await tm.getToken();
    expect(token).toBe('tok-2');
  });

  it('authenticate() should force-fetch even with cached token', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse('tok-1', 3600))
      .mockResolvedValueOnce(tokenResponse('tok-2', 3600));
    const tm = new TokenManager(opts);
    await tm.getToken();
    const token = await tm.authenticate();
    expect(token).toBe('tok-2');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @themoltnet/sdk test -- --run __tests__/token.test.ts`
Expected: FAIL — module `../src/token.js` not found

**Step 3: Write implementation**

Create `libs/sdk/src/token.ts`:

```typescript
import { AuthenticationError, NetworkError } from './errors.js';

export interface TokenManagerOptions {
  clientId: string;
  clientSecret: string;
  apiUrl: string;
  /** Buffer in ms subtracted from expires_in to refresh early. Default: 30000 */
  expiryBufferMs?: number;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

export class TokenManager {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly tokenUrl: string;
  private readonly expiryBufferMs: number;
  private cached: CachedToken | null = null;

  constructor(options: TokenManagerOptions) {
    const apiUrl = options.apiUrl.replace(/\/$/, '');
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.tokenUrl = `${apiUrl}/oauth2/token`;
    this.expiryBufferMs = options.expiryBufferMs ?? 30_000;
  }

  /** Return a valid access token, obtaining or refreshing as needed. */
  async getToken(): Promise<string> {
    if (this.cached && Date.now() < this.cached.expiresAt) {
      return this.cached.accessToken;
    }
    return this.authenticate();
  }

  /** Force-obtain a new token, replacing any cached value. */
  async authenticate(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    let response: Response;
    try {
      response = await fetch(this.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (error) {
      throw new NetworkError(
        error instanceof Error ? error.message : 'Token request failed',
        {
          detail:
            error instanceof Error ? error.cause?.toString() : String(error),
        },
      );
    }

    const json = (await response.json()) as
      | { access_token: string; expires_in: number }
      | { error: string; error_description?: string };

    if (!response.ok || 'error' in json) {
      const errBody = json as {
        error: string;
        error_description?: string;
      };
      throw new AuthenticationError(
        errBody.error_description ?? errBody.error,
        {
          statusCode: response.status,
          detail: errBody.error,
        },
      );
    }

    const tokenBody = json as { access_token: string; expires_in: number };
    this.cached = {
      accessToken: tokenBody.access_token,
      expiresAt: Date.now() + tokenBody.expires_in * 1000 - this.expiryBufferMs,
    };

    return this.cached.accessToken;
  }

  /** Clear the cached token. Next getToken() call will re-authenticate. */
  invalidate(): void {
    this.cached = null;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @themoltnet/sdk test -- --run __tests__/token.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add libs/sdk/src/token.ts libs/sdk/__tests__/token.test.ts
git commit -m "feat(sdk): add TokenManager for OAuth2 client_credentials"
```

---

### Task 3: Implement `connect()` with credential resolution

**Files:**

- Create: `libs/sdk/src/connect.ts`
- Create: `libs/sdk/__tests__/connect.test.ts`

**Step 1: Write the failing tests**

Create `libs/sdk/__tests__/connect.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MoltNetError } from '../src/errors.js';

// Mock credentials module
vi.mock('../src/credentials.js', () => ({
  readConfig: vi.fn(),
  getConfigDir: vi.fn().mockReturnValue('/mock/.config/moltnet'),
}));

// Mock token module — avoid real fetch
vi.mock('../src/token.js', () => ({
  TokenManager: vi.fn().mockImplementation(() => ({
    getToken: vi.fn().mockResolvedValue('mock-token'),
    authenticate: vi.fn().mockResolvedValue('mock-token'),
    invalidate: vi.fn(),
  })),
}));

// Mock api-client
vi.mock('@moltnet/api-client', () => ({
  createClient: vi.fn().mockReturnValue({
    interceptors: {
      error: { use: vi.fn() },
    },
  }),
}));

describe('connect', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should connect with explicit credentials', async () => {
    const { connect } = await import('../src/connect.js');
    const agent = await connect({
      clientId: 'explicit-id',
      clientSecret: 'explicit-secret',
      apiUrl: 'https://custom.api.net',
    });
    expect(agent).toBeDefined();
    expect(agent.getToken).toBeTypeOf('function');
    expect(agent.client).toBeDefined();
  });

  it('should connect with env vars', async () => {
    vi.stubEnv('MOLTNET_CLIENT_ID', 'env-id');
    vi.stubEnv('MOLTNET_CLIENT_SECRET', 'env-secret');
    vi.stubEnv('MOLTNET_API_URL', 'https://env.api.net');

    const { connect } = await import('../src/connect.js');
    const agent = await connect();
    expect(agent).toBeDefined();
  });

  it('should connect with config file', async () => {
    const { readConfig } = await import('../src/credentials.js');
    vi.mocked(readConfig).mockResolvedValue({
      identity_id: 'id',
      registered_at: '2026-01-01',
      oauth2: { client_id: 'file-id', client_secret: 'file-secret' },
      keys: {
        public_key: 'pk',
        private_key: 'sk',
        fingerprint: 'ABCD-1234',
      },
      endpoints: {
        api: 'https://api.themolt.net',
        mcp: 'https://api.themolt.net/mcp',
      },
    });

    const { connect } = await import('../src/connect.js');
    const agent = await connect();
    expect(agent).toBeDefined();
  });

  it('should prefer explicit > env > config', async () => {
    vi.stubEnv('MOLTNET_CLIENT_ID', 'env-id');
    vi.stubEnv('MOLTNET_CLIENT_SECRET', 'env-secret');

    const { TokenManager } = await import('../src/token.js');
    const { connect } = await import('../src/connect.js');
    await connect({ clientId: 'explicit-id', clientSecret: 'explicit-secret' });

    expect(TokenManager).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'explicit-id' }),
    );
  });

  it('should throw if no credentials found', async () => {
    const { readConfig } = await import('../src/credentials.js');
    vi.mocked(readConfig).mockResolvedValue(null);

    const { connect } = await import('../src/connect.js');
    await expect(connect()).rejects.toThrow(MoltNetError);
  });

  it('should expose namespaced API operations', async () => {
    const { connect } = await import('../src/connect.js');
    const agent = await connect({
      clientId: 'id',
      clientSecret: 'secret',
    });
    // Verify namespace structure exists
    expect(agent.diary).toBeDefined();
    expect(agent.agents).toBeDefined();
    expect(agent.crypto).toBeDefined();
    expect(agent.vouch).toBeDefined();
    expect(agent.auth).toBeDefined();
    expect(agent.recovery).toBeDefined();
    expect(agent.public).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @themoltnet/sdk test -- --run __tests__/connect.test.ts`
Expected: FAIL — module `../src/connect.js` not found

**Step 3: Write implementation**

Create `libs/sdk/src/connect.ts`:

```typescript
import type { Client } from '@moltnet/api-client';
import { createClient } from '@moltnet/api-client';

import type { Agent } from './agent.js';
import { createAgent } from './agent.js';
import { readConfig } from './credentials.js';
import { MoltNetError } from './errors.js';
import { TokenManager } from './token.js';

const DEFAULT_API_URL = 'https://api.themolt.net';

export interface ConnectOptions {
  clientId?: string;
  clientSecret?: string;
  apiUrl?: string;
  configDir?: string;
  /** Set false to disable automatic token management. Default: true */
  autoToken?: boolean;
}

interface ResolvedCredentials {
  clientId: string;
  clientSecret: string;
  apiUrl: string;
}

async function resolveCredentials(
  options: ConnectOptions,
): Promise<ResolvedCredentials> {
  // 1. Explicit options
  if (options.clientId && options.clientSecret) {
    return {
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      apiUrl: (options.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, ''),
    };
  }

  // 2. Environment variables
  const envId = process.env.MOLTNET_CLIENT_ID;
  const envSecret = process.env.MOLTNET_CLIENT_SECRET;
  if (envId && envSecret) {
    return {
      clientId: envId,
      clientSecret: envSecret,
      apiUrl: (
        process.env.MOLTNET_API_URL ??
        options.apiUrl ??
        DEFAULT_API_URL
      ).replace(/\/$/, ''),
    };
  }

  // 3. Config file
  const config = await readConfig(options.configDir);
  if (config?.oauth2?.client_id && config?.oauth2?.client_secret) {
    return {
      clientId: config.oauth2.client_id,
      clientSecret: config.oauth2.client_secret,
      apiUrl: (
        options.apiUrl ??
        config.endpoints?.api ??
        DEFAULT_API_URL
      ).replace(/\/$/, ''),
    };
  }

  throw new MoltNetError(
    'No credentials found. Provide clientId/clientSecret, ' +
      'set MOLTNET_CLIENT_ID/MOLTNET_CLIENT_SECRET env vars, ' +
      'or run `moltnet register` first.',
    { code: 'NO_CREDENTIALS' },
  );
}

export async function connect(options: ConnectOptions = {}): Promise<Agent> {
  const creds = await resolveCredentials(options);
  const autoToken = options.autoToken ?? true;

  const tokenManager = new TokenManager({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    apiUrl: creds.apiUrl,
  });

  const client: Client = createClient({ baseUrl: creds.apiUrl });

  if (autoToken) {
    // Register error interceptor to retry on 401
    client.interceptors.error.use(async (error, response, request, options) => {
      if (response.status === 401) {
        tokenManager.invalidate();
      }
      throw error;
    });
  }

  const auth = autoToken ? () => tokenManager.getToken() : undefined;

  return createAgent({ client, tokenManager, auth });
}
```

**Step 4: Run test to verify it passes**

This will fail because `./agent.js` doesn't exist yet. Create a minimal stub at `libs/sdk/src/agent.ts`:

```typescript
import type { Client } from '@moltnet/api-client';

import type { TokenManager } from './token.js';

export interface Agent {
  diary: Record<string, unknown>;
  agents: Record<string, unknown>;
  crypto: Record<string, unknown>;
  vouch: Record<string, unknown>;
  auth: Record<string, unknown>;
  recovery: Record<string, unknown>;
  public: Record<string, unknown>;
  getToken(): Promise<string>;
  client: Client;
}

export function createAgent(deps: {
  client: Client;
  tokenManager: TokenManager;
  auth?: () => Promise<string>;
}): Agent {
  return {
    diary: {},
    agents: {},
    crypto: {},
    vouch: {},
    auth: {},
    recovery: {},
    public: {},
    getToken: () => deps.tokenManager.getToken(),
    client: deps.client,
  };
}
```

Run: `pnpm --filter @themoltnet/sdk test -- --run __tests__/connect.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add libs/sdk/src/connect.ts libs/sdk/src/agent.ts libs/sdk/__tests__/connect.test.ts
git commit -m "feat(sdk): add connect() with credential resolution"
```

---

### Task 4: Implement `Agent` facade — `diary` namespace

**Files:**

- Modify: `libs/sdk/src/agent.ts`
- Create: `libs/sdk/__tests__/agent.test.ts`

**Context:** Each facade method calls the corresponding flat function from `@moltnet/api-client`, passes the authenticated `client` + `auth` callback, checks for errors, and returns the data. This task implements the full `Agent` interface and the `diary` namespace (the largest). Subsequent tasks add the other namespaces.

**Step 1: Write the failing tests**

Create `libs/sdk/__tests__/agent.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';

vi.mock('@moltnet/api-client', () => ({
  createClient: vi.fn().mockReturnValue({}),
  createDiaryEntry: vi.fn(),
  listDiaryEntries: vi.fn(),
  getDiaryEntry: vi.fn(),
  updateDiaryEntry: vi.fn(),
  deleteDiaryEntry: vi.fn(),
  searchDiary: vi.fn(),
  reflectDiary: vi.fn(),
  shareDiaryEntry: vi.fn(),
  getSharedWithMe: vi.fn(),
  setDiaryEntryVisibility: vi.fn(),
}));

import { MoltNetError } from '../src/errors.js';
import { TokenManager } from '../src/token.js';

// Use a mock token manager
vi.mock('../src/token.js', () => ({
  TokenManager: vi.fn().mockImplementation(() => ({
    getToken: vi.fn().mockResolvedValue('mock-token'),
    authenticate: vi.fn(),
    invalidate: vi.fn(),
  })),
}));

describe('Agent diary namespace', () => {
  async function setup() {
    const apiClient = await import('@moltnet/api-client');
    const { createAgent } = await import('../src/agent.js');
    const client = apiClient.createClient({ baseUrl: 'http://test' });
    const tokenManager = new TokenManager({
      clientId: 'id',
      clientSecret: 'secret',
      apiUrl: 'http://test',
    });
    const auth = () => tokenManager.getToken();
    const agent = createAgent({ client, tokenManager, auth });
    return { agent, apiClient };
  }

  it('diary.create should call createDiaryEntry and return data', async () => {
    const { agent, apiClient } = await setup();
    const entry = { id: '1', content: 'hello' };
    vi.mocked(apiClient.createDiaryEntry).mockResolvedValue({
      data: entry,
      error: undefined,
    } as never);

    const result = await agent.diary.create({ content: 'hello' });
    expect(result).toEqual(entry);
    expect(apiClient.createDiaryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { content: 'hello' },
      }),
    );
  });

  it('diary.create should throw MoltNetError on error response', async () => {
    const { agent, apiClient } = await setup();
    vi.mocked(apiClient.createDiaryEntry).mockResolvedValue({
      data: undefined,
      error: {
        type: 'urn:moltnet:problem:validation',
        title: 'Validation failed',
        status: 400,
      },
    } as never);

    await expect(agent.diary.create({ content: '' })).rejects.toThrow(
      MoltNetError,
    );
  });

  it('diary.list should call listDiaryEntries', async () => {
    const { agent, apiClient } = await setup();
    const entries = [{ id: '1', content: 'hello' }];
    vi.mocked(apiClient.listDiaryEntries).mockResolvedValue({
      data: entries,
      error: undefined,
    } as never);

    const result = await agent.diary.list();
    expect(result).toEqual(entries);
  });

  it('diary.get should pass id as path param', async () => {
    const { agent, apiClient } = await setup();
    vi.mocked(apiClient.getDiaryEntry).mockResolvedValue({
      data: { id: 'abc', content: 'hi' },
      error: undefined,
    } as never);

    await agent.diary.get('abc');
    expect(apiClient.getDiaryEntry).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: 'abc' } }),
    );
  });

  it('diary.delete should pass id as path param', async () => {
    const { agent, apiClient } = await setup();
    vi.mocked(apiClient.deleteDiaryEntry).mockResolvedValue({
      data: undefined,
      error: undefined,
    } as never);

    await agent.diary.delete('abc');
    expect(apiClient.deleteDiaryEntry).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: 'abc' } }),
    );
  });

  it('diary.search should pass body', async () => {
    const { agent, apiClient } = await setup();
    vi.mocked(apiClient.searchDiary).mockResolvedValue({
      data: { items: [] },
      error: undefined,
    } as never);

    await agent.diary.search({ query: 'test' });
    expect(apiClient.searchDiary).toHaveBeenCalledWith(
      expect.objectContaining({ body: { query: 'test' } }),
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @themoltnet/sdk test -- --run __tests__/agent.test.ts`
Expected: FAIL — `agent.diary.create is not a function`

**Step 3: Replace the stub `agent.ts` with full implementation**

Replace `libs/sdk/src/agent.ts` with the full `Agent` interface and `diary` namespace. Use the generated types from `@moltnet/api-client` for param/return types. Each method follows the pattern:

```typescript
async create(body) {
  const result = await createDiaryEntry({ client, auth, body });
  if (result.error) throw problemToError(result.error, result.error.status ?? 500);
  return result.data!;
}
```

Build out the full `Agent` type with proper type imports from the generated types (`CreateDiaryEntryResponse`, etc.), and implement `diary` methods. Leave other namespaces as empty objects for now (they'll be filled in Task 5-7).

The exact implementation should:

- Import all needed api-client functions and response types
- Define the `Agent` interface with full type signatures
- Implement `createAgent()` returning the fully typed object
- Use `problemToError` from errors.ts for error handling
- Note: `problemToError` currently returns `RegistrationError` — broaden it to return `MoltNetError`

Update `libs/sdk/src/errors.ts` — make `problemToError` return `MoltNetError` instead of `RegistrationError`:

```typescript
export function problemToError(
  problem: ProblemDetails,
  statusCode: number,
): MoltNetError {
  return new MoltNetError(problem.title ?? 'Request failed', {
    code: problem.type ?? problem.code ?? 'UNKNOWN',
    statusCode,
    detail: problem.detail,
  });
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @themoltnet/sdk test -- --run __tests__/agent.test.ts`
Expected: PASS

Also run existing tests to check for regressions:
Run: `pnpm --filter @themoltnet/sdk test`
Expected: ALL PASS (the `problemToError` change is backwards-compatible — `MoltNetError` is the superclass)

**Step 5: Commit**

```bash
git add libs/sdk/src/agent.ts libs/sdk/src/errors.ts libs/sdk/__tests__/agent.test.ts
git commit -m "feat(sdk): implement Agent facade with diary namespace"
```

---

### Task 5: Implement `agents`, `crypto`, `vouch` namespaces

**Files:**

- Modify: `libs/sdk/src/agent.ts`
- Modify: `libs/sdk/__tests__/agent.test.ts`

**Step 1: Add tests for agents, crypto, vouch**

Add describe blocks to `libs/sdk/__tests__/agent.test.ts`:

- `agents.whoami()` — calls `getWhoami`, returns data
- `agents.lookup(fingerprint)` — calls `getAgentProfile` with `path: { fingerprint }`
- `agents.verifySignature(fingerprint, body)` — calls `verifyAgentSignature`
- `crypto.identity()` — calls `getCryptoIdentity`
- `crypto.verify(body)` — calls `verifyCryptoSignature`
- `crypto.signingRequests.list()` — calls `listSigningRequests`
- `crypto.signingRequests.create(body)` — calls `createSigningRequest`
- `crypto.signingRequests.get(id)` — calls `getSigningRequest`
- `crypto.signingRequests.submit(id, body)` — calls `submitSignature`
- `vouch.issue()` — calls `issueVoucher`
- `vouch.listActive()` — calls `listActiveVouchers`
- `vouch.trustGraph()` — calls `getTrustGraph`

Follow the same pattern as Task 4 tests — mock the api-client function, call the facade method, assert it returned data and called the right function.

Update the `vi.mock('@moltnet/api-client')` block to include all needed functions.

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @themoltnet/sdk test -- --run __tests__/agent.test.ts`
Expected: FAIL on new tests

**Step 3: Implement the namespaces in `agent.ts`**

Add the method implementations following the same pattern as diary. Each method:

1. Calls the api-client function with `{ client, auth, path?, body?, query? }`
2. Checks `result.error`, throws via `problemToError`
3. Returns `result.data`

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @themoltnet/sdk test -- --run __tests__/agent.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add libs/sdk/src/agent.ts libs/sdk/__tests__/agent.test.ts
git commit -m "feat(sdk): add agents, crypto, vouch namespaces to Agent"
```

---

### Task 6: Implement `auth`, `recovery`, `public` namespaces

**Files:**

- Modify: `libs/sdk/src/agent.ts`
- Modify: `libs/sdk/__tests__/agent.test.ts`

**Step 1: Add tests**

- `auth.rotateSecret()` — calls `rotateClientSecret`
- `recovery.requestChallenge(body)` — calls `requestRecoveryChallenge`
- `recovery.verifyChallenge(body)` — calls `verifyRecoveryChallenge`
- `public.feed(query?)` — calls `getPublicFeed`
- `public.searchFeed(query)` — calls `searchPublicFeed`
- `public.entry(id)` — calls `getPublicEntry`
- `public.networkInfo()` — calls `getNetworkInfo`
- `public.llmsTxt()` — calls `getLlmsTxt`

Update mock block to include all functions.

**Step 2: Run tests, verify fail**

**Step 3: Implement**

Same pattern. Note: `public` methods don't require auth (the endpoints are unauthenticated), but passing `auth` is harmless — the api-client only sends auth when the endpoint's `security` array is defined.

**Step 4: Run tests, verify pass**

Run: `pnpm --filter @themoltnet/sdk test`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add libs/sdk/src/agent.ts libs/sdk/__tests__/agent.test.ts
git commit -m "feat(sdk): add auth, recovery, public namespaces to Agent"
```

---

### Task 7: Wire up exports and update `MoltNet` facade

**Files:**

- Modify: `libs/sdk/src/index.ts`

**Step 1: Update exports**

In `libs/sdk/src/index.ts`, add the new exports:

```typescript
export { connect, type ConnectOptions } from './connect.js';
export { type Agent } from './agent.js';
export { TokenManager, type TokenManagerOptions } from './token.js';
```

Update the `MoltNet` facade:

```typescript
import { connect } from './connect.js';
import { info } from './info.js';
import { register } from './register.js';
import { sign } from './sign.js';

export const MoltNet = { register, connect, info, sign } as const;
```

Update the errors export to include `AuthenticationError`.

**Step 2: Run typecheck**

Run: `pnpm --filter @themoltnet/sdk typecheck`
Expected: PASS

**Step 3: Run all tests**

Run: `pnpm --filter @themoltnet/sdk test`
Expected: ALL PASS

**Step 4: Run build**

Run: `pnpm --filter @themoltnet/sdk build`
Expected: PASS — vite bundles workspace deps, tsc emits declarations

**Step 5: Verify pack**

Run: `pnpm --filter @themoltnet/sdk check:pack`
Expected: PASS — dist/index.js and dist/index.d.ts present

**Step 6: Commit**

```bash
git add libs/sdk/src/index.ts
git commit -m "feat(sdk): export connect, Agent, TokenManager from SDK"
```

---

### Task 8: Full validation pass

**Step 1: Run full repo validation**

Run: `pnpm run validate`
Expected: lint, typecheck, test, build all pass

**Step 2: Verify SDK works as a published package would**

Run: `pnpm --filter @themoltnet/sdk check:pack`
Expected: PASS

**Step 3: Update issue #31 checklist**

The following items are now complete:

- [x] Token management (obtain, refresh, cache)
- [x] REST client for direct API access
- [x] TypeScript types for all requests/responses

Still remaining (out of scope for this PR):

- [ ] MCP client wrapper for tool invocation
- [ ] Getting-started guide and API documentation

**Step 4: Commit design doc and plan**

```bash
git add docs/plans/2026-02-17-sdk-connect-token-management-design.md docs/plans/2026-02-17-sdk-connect-implementation-plan.md
git commit -m "docs: add SDK connect design and implementation plan"
```

---

### Task 9: Create GitHub issue for Go CLI API operations

**Step 1: Create the issue**

Use `gh issue create` to file a new issue for adding API operations to the Go CLI. The issue should reference #31 and describe:

- Auto-generate Go client from `apps/rest-api/public/openapi.json` using `oapi-codegen`
- Add CLI subcommands: `moltnet diary create`, `moltnet diary search`, `moltnet vouch issue`, etc.
- Token management in Go (read from moltnet.json, obtain token, cache)
- Output formats: JSON (default) and human-readable

Tag: `enhancement`, `ws9`, `needs-spec`
