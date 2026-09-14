# SDK register writes the identity store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** `register()` from `@themoltnet/sdk/node` does what `moltnet register`
does: seed and credential stored as references in a secret provider, canonical
`moltnet.json` written in a recoverable order, selector seeded, whoami verified,
alias published for OAuth2 identities. The daemon's managed-agent path uses it.

**Architecture:** The in-memory request becomes `requestRegistration()` in
`libs/sdk/src/register.ts`, exported from that module for its tests but no
longer from the package root. A new `libs/sdk/src/register-node.ts` composes it
with a `SecretProvider`, `writeConfig`, the in-memory `connect`, and a new
`agents.updateWhoami` namespace call; `@themoltnet/sdk/node` exports `register`
and `enroll`. `@moltnet/agent-config` seeds the identity selector next to the
identities directory it writes into, so a daemon store with a custom root gets
the right selector. `createManagedAgent` keeps alias reservation, the
pending-registration marker, and the activation record, and delegates everything
else.

**Tech Stack:** TypeScript, Vitest (`libs/sdk/__tests__`,
`libs/agent-config/__tests__`, `apps/agent-daemon/src/**/*.test.ts`),
`@moltnet/api-client`, `@moltnet/agent-config`.

**Spec:**
`docs/superpowers/specs/2026-09-14-register-recover-onboarding-design.md`,
Component C. Deviation recorded in Task 0: alias publication is skipped for
agent-key identities because `PATCH /agents/whoami` rejects agent keys.

## Global Constraints

- Work in this worktree on a branch cut from `fix/cli-register-seed-reference`
  (PR 2), named `feat/sdk-register-identity-store`.
- Every commit needs a LeGreffier diary entry first:
  `moltnet entry commit --diary-id 6e4d9948-8ec5-4f59-b82a-3acbc4bbc396 --risk <level> --scope "<areas>" --operator edouard --tool claude --title "<short title>" --rationale "<3-6 sentences>"`,
  then `MoltNet-Diary: <entryId>` in the commit body. Always pass `--title`. Add
  `Task-Group: sdk-register-identity-store` to every commit,
  `Task-Family: feature` on the first, `Task-Completes: true` on the last.
- End every commit body with
  `Claude-Session: https://claude.ai/code/session_015FWKhcNAMs5RKTEkA3bLsS`.
- Conventional commit types, no `!` breaking marker. The SDK change ships as
  `feat(sdk)`.
- Nx: `pnpm exec nx run @moltnet/agent-config:test`,
  `pnpm exec nx run @themoltnet/sdk:test`,
  `pnpm exec nx run @themoltnet/agent-daemon:test`, plus `lint` and `typecheck`
  for each touched project.
- No dynamic `import()` in tests. Static imports only. Tests never touch the
  real OS keyring or the real `~/.config/moltnet`; mock `node:os` `homedir` the
  way `libs/agent-config/__tests__/identity-resolution.test.ts` does, or pass an
  explicit `configDir` under a temp root.
- This repository is public. Commit messages describe the mechanism, never a
  weakness.

---

## File structure

- Modify `libs/agent-config/src/config.ts:256-274`: selector path derived from
  the identity directory's parent.
- Modify `libs/agent-config/__tests__/identity-resolution.test.ts`: custom-root
  selector test.
- Modify `libs/sdk/src/errors.ts`: add `RegisterIdentityError`.
- Modify `libs/sdk/src/register.ts`: rename `register` to `requestRegistration`,
  accept an optional prepared keypair, drop `enroll` and `mcpConfig` from the
  result.
- Modify `libs/sdk/src/agent.ts` and `libs/sdk/src/namespaces/agents.ts`:
  `agents.updateWhoami({ alias })`.
- Create `libs/sdk/src/register-node.ts`: `register`, `enroll`,
  `RegisterOptions`, `RegisterResult`.
- Modify `libs/sdk/src/node.ts`: export the three plus the error class
  re-export.
- Modify `libs/sdk/src/index.ts`: stop exporting `register`, `enroll`,
  `RegisterOptions`, `EnrollOptions`, `RegisterResult`; drop them from the
  `MoltNet` const; export `RegisterIdentityError`.
- Modify `libs/sdk/__tests__/register.test.ts`: import `requestRegistration`.
- Create `libs/sdk/__tests__/register-node.test.ts`.
- Modify `apps/agent-daemon/src/lib/agent-server/identity.ts:115-257`: delegate
  to `register`.
- Modify `apps/agent-daemon/src/lib/agent-server/identity.test.ts`: mock the API
  client and crypto service instead of the SDK register.
- Modify
  `docs/superpowers/specs/2026-09-14-register-recover-onboarding-design.md`:
  alias publication note.

---

### Task 0: Record the spec deviation

**Files:**

- Modify:
  `docs/superpowers/specs/2026-09-14-register-recover-onboarding-design.md`

- [ ] **Step 1: Amend the spec**

In Component C, step 8, replace `If \`publishAlias\`, call the whoami update
with the alias.` with:

```
8. If `publishAlias` (default: true for `oauth2`, forced false for
   `agent_key`, because `PATCH /agents/whoami` accepts only the agent's
   primary credential and rejects agent keys), call the whoami update with
   the alias.
```

and in the Daemon subsection replace
`Managed agents now get a published network alias, which the Console already displays for CLI-created agents.`
with
`Managed agents keep no published network alias; their agent key cannot call the whoami update.`

This commit is folded into Task 1's commit.

---

### Task 1: Selector seeding follows the identities directory

**Files:**

- Modify: `libs/agent-config/src/config.ts:11,256-274`
- Test: `libs/agent-config/__tests__/identity-resolution.test.ts`

**Interfaces:**

- Produces: unchanged signature `writeConfig(config, configDir?)`. When
  `configDir` is `<root>/identities/<alias>`, the selector is
  `<root>/identity-selector.json`; otherwise it stays
  `getConfigDir()/identity-selector.json`.

- [ ] **Step 1: Write the failing test**

In `libs/agent-config/__tests__/identity-resolution.test.ts`, inside
`describe('identity resolution ladder')`, add:

```ts
it('seeds the selector beside a custom identities root, not the default store', async () => {
  const home = await freshHome();
  const customRoot = join(home, 'agent-server');
  const identityDir = join(customRoot, 'identities', 'managed-one');

  await writeConfig(credentials('managed'), identityDir);

  const seeded = JSON.parse(
    await readFile(join(customRoot, 'identity-selector.json'), 'utf-8'),
  ) as { version: number; default_identity?: string };
  expect(seeded).toEqual({ version: 1, default_identity: 'managed-one' });
  await expect(
    readFile(join(getConfigDir(), 'identity-selector.json'), 'utf-8'),
  ).rejects.toMatchObject({ code: 'ENOENT' });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
`pnpm exec nx run @moltnet/agent-config:test -- __tests__/identity-resolution.test.ts`
Expected: FAIL, the custom root has no selector and the default store does.

- [ ] **Step 3: Implement**

In `libs/agent-config/src/config.ts`, change the path import to
`import { basename, dirname, join, sep } from 'node:path';` and replace
`seedIdentitySelectorIfUnset` with:

```ts
/**
 * Idempotent: an existing default is never overwritten. The selector lives
 * beside the `identities` directory the config is written into, so a store
 * with a custom root (the daemon's agent server) seeds its own selector
 * instead of the default one under the home directory.
 */
async function seedIdentitySelectorIfUnset(identityDir: string): Promise<void> {
  const alias = identityDir.split(sep).pop();
  if (!alias || !IDENTITY_ALIAS_PATTERN.test(alias)) return;
  const parent = dirname(identityDir);
  const root =
    basename(parent) === identitiesDirName ? dirname(parent) : getConfigDir();
  const selectorPath = join(root, 'identity-selector.json');
  try {
    const existing = JSON.parse(
      await readFile(selectorPath, 'utf-8'),
    ) as IdentitySelector;
    if (existing.default_identity?.trim()) return;
  } catch {
    // Absent or unreadable: write a fresh one below.
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(
    selectorPath,
    JSON.stringify({ version: 1, default_identity: alias }, null, 2) + '\n',
    { mode: 0o600 },
  );
}
```

`identitiesDirName` is declared later in the file as a `const`; move its
declaration above this function if TypeScript's temporal-dead-zone check
complains (it will not at runtime since the function runs later, but keep the
file readable).

- [ ] **Step 4: Run the tests, lint, typecheck**

Run:
`pnpm exec nx run-many -t test lint typecheck --projects=@moltnet/agent-config`
Expected: success.

- [ ] **Step 5: Diary entry and commit**

```bash
git add libs/agent-config/src/config.ts libs/agent-config/__tests__/identity-resolution.test.ts docs/superpowers/specs/2026-09-14-register-recover-onboarding-design.md
moltnet entry commit --diary-id 6e4d9948-8ec5-4f59-b82a-3acbc4bbc396 --risk low --scope "agent-config,sdk" --operator edouard --tool claude --title "fix(agent-config): seed the selector beside the identities root" --rationale "writeConfig seeded identity-selector.json under the default home store even when an explicit configDir lived under another root, so SDK registration into the daemon's agent-server store would have selected the wrong default. The selector is now written beside the identities directory the config lands in, falling back to the default store otherwise. Also records the spec deviation that managed agents cannot publish a network alias because the whoami update rejects agent keys."
git commit -m "fix(agent-config): seed the selector beside the identities root" -m "MoltNet-Diary: <entryId>
Task-Group: sdk-register-identity-store
Task-Family: feature

Claude-Session: https://claude.ai/code/session_015FWKhcNAMs5RKTEkA3bLsS"
```

---

### Task 2: `requestRegistration`, the error class, and `agents.updateWhoami`

**Files:**

- Modify: `libs/sdk/src/errors.ts`
- Modify: `libs/sdk/src/register.ts`
- Modify: `libs/sdk/src/agent.ts:461-471`
- Modify: `libs/sdk/src/namespaces/agents.ts`
- Modify: `libs/sdk/src/index.ts:145-160,255-268`
- Modify: `libs/sdk/__tests__/register.test.ts`

**Interfaces:**

- Produces:

  ```ts
  // errors.ts
  export type RegisterIdentityErrorCode =
    | 'alias_exists'
    | 'provider_unavailable'
    | 'registration_failed'
    | 'registration_incomplete'
    | 'unsupported_credential'
    | 'identity_mismatch';
  export class RegisterIdentityError extends MoltNetError {
    readonly code: RegisterIdentityErrorCode;
    readonly subjectId?: string;
    readonly fingerprint?: string;
    readonly configPath?: string;
    readonly recoveryCommand?: string;
    constructor(
      code,
      message,
      options?: {
        cause?: unknown;
        statusCode?: number;
        detail?: string;
        subjectId?;
        fingerprint?;
        configPath?;
        recoveryCommand?;
      },
    );
  }
  // register.ts (module export, not package export)
  export interface RequestRegistrationOptions {
    credentialType: BootstrapCredentialType;
    enrollmentToken?: string;
    apiUrl?: string;
    keyPair?: KeyPair; // generated when absent
    signal?: AbortSignal;
  }
  export interface RegistrationRequestResult {
    identity: {
      publicKey: string;
      privateKey: string;
      fingerprint: string;
      subjectId: string;
      subjectType: 'agent';
    };
    credentials: RegistrationCredentials;
    apiUrl: string;
  }
  export function requestRegistration(
    options: RequestRegistrationOptions,
  ): Promise<RegistrationRequestResult>;
  // agent.ts
  interface AgentsNamespace {
    updateWhoami(
      body: { alias: string },
      options?: { signal?: AbortSignal },
    ): Promise<UpdateWhoamiResponse>;
  }
  ```

- [ ] **Step 1: Update the existing tests to the new name**

In `libs/sdk/__tests__/register.test.ts`, change the import to
`requestRegistration` and replace every `register(` call in the file with
`requestRegistration(`. Remove the two `mcpConfig` assertions
(`expect(result.mcpConfig...)` in the first two tests); the `buildMcpConfig`
helper test at the bottom stays. Add one test:

```ts
it('signs with a prepared keypair instead of generating one', async () => {
  vi.mocked(registerAgent).mockResolvedValue(success(oauthResponse));

  await requestRegistration({
    credentialType: 'oauth2',
    keyPair: {
      publicKey: 'ed25519:prepared',
      privateKey: 'prepared-seed',
      fingerprint: 'PREP-0000-0000-0000',
    },
  });

  expect(cryptoService.generateKeyPair).not.toHaveBeenCalled();
  expect(cryptoService.sign).toHaveBeenCalledWith(
    expect.stringContaining('ed25519:prepared'),
    'prepared-seed',
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec nx run @themoltnet/sdk:test -- __tests__/register.test.ts`
Expected: FAIL, `requestRegistration` is not exported.

- [ ] **Step 3: Add the error class**

Append to `libs/sdk/src/errors.ts`:

```ts
export type RegisterIdentityErrorCode =
  | 'alias_exists'
  | 'provider_unavailable'
  | 'registration_failed'
  | 'registration_incomplete'
  | 'unsupported_credential'
  | 'identity_mismatch';

/**
 * Failure of the persisting `register()` in `@themoltnet/sdk/node`.
 *
 * `registration_failed` means the server rejected the request and nothing
 * was kept locally. `registration_incomplete` means the server committed the
 * identity; the seed and config that exist are enough for
 * `moltnet agents credentials recover --yes` to finish the job, which
 * `recoveryCommand` spells out.
 */
export class RegisterIdentityError extends MoltNetError {
  override readonly code: RegisterIdentityErrorCode;
  readonly subjectId?: string;
  readonly fingerprint?: string;
  readonly configPath?: string;
  readonly recoveryCommand?: string;

  constructor(
    code: RegisterIdentityErrorCode,
    message: string,
    options: {
      cause?: unknown;
      statusCode?: number;
      detail?: string;
      subjectId?: string;
      fingerprint?: string;
      configPath?: string;
      recoveryCommand?: string;
    } = {},
  ) {
    super(message, {
      code,
      statusCode: options.statusCode,
      detail: options.detail,
    });
    this.name = 'RegisterIdentityError';
    this.code = code;
    this.cause = options.cause;
    this.subjectId = options.subjectId;
    this.fingerprint = options.fingerprint;
    this.configPath = options.configPath;
    this.recoveryCommand = options.recoveryCommand;
  }
}
```

If `MoltNetError.code` is declared `readonly code: string`, the `override`
narrowing above is valid; drop `override` if the compiler objects and keep the
field.

- [ ] **Step 4: Rename and extend the request function**

In `libs/sdk/src/register.ts`:

- Import `type KeyPair` from `@moltnet/crypto-service` (check the exported name
  with
  `grep -n 'export interface KeyPair\|export type KeyPair' libs/crypto-service/src/*.ts`).
- Replace `RegisterOptions` with `RequestRegistrationOptions` (fields above),
  delete `EnrollOptions`, `McpConfig` stays, delete `mcpConfig` and
  `buildMcpConfig` usage from the result but keep `buildMcpConfig` exported
  (config.ts uses the type and index.ts re-exports the function).
- Rename `RegisterResult` to `RegistrationRequestResult` without `mcpConfig`.
- Rename `register` to `requestRegistration`; replace
  `const keyPair = await cryptoService.generateKeyPair();` with
  `const keyPair = options.keyPair ?? (await cryptoService.generateKeyPair());`;
  drop the `mcpConfig` property from the returned object.
- Delete `enroll`.

- [ ] **Step 5: Add `agents.updateWhoami`**

In `libs/sdk/src/agent.ts`, add `UpdateWhoamiResponse` to the
`@moltnet/api-client` type imports and extend `AgentsNamespace`:

```ts
  /**
   * Publish this agent's network alias. Only the primary credential may
   * call this; an agent key is rejected by the server.
   */
  updateWhoami(
    body: { alias: string },
    options?: { signal?: AbortSignal },
  ): Promise<UpdateWhoamiResponse>;
```

In `libs/sdk/src/namespaces/agents.ts`, import `updateWhoami` from
`@moltnet/api-client` and add to the returned object:

```ts
    async updateWhoami(body, options) {
      return unwrapResult(
        await updateWhoami({
          client,
          auth: context.auth,
          body,
          ...(options?.signal ? { signal: options.signal } : {}),
        }),
      );
    },
```

Check `createWhoami` in `namespaces/whoami.ts` for how `auth` is passed and
mirror it exactly.

- [ ] **Step 6: Update the package root exports**

In `libs/sdk/src/index.ts`, the `./register.js` export block becomes:

```ts
export {
  type BootstrapCredentialType,
  buildMcpConfig,
  buildSelfRegistrationMessage,
  buildTeamRegistrationMessage,
  createIdempotencyKey,
  type McpConfig,
  type RegistrationCredentials,
} from './register.js';
```

Add `RegisterIdentityError` and `type RegisterIdentityErrorCode` to the
`./errors.js` export block. Remove
`import { enroll, register } from './register.js';` and the `register,` /
`enroll,` entries from the `MoltNet` const.

- [ ] **Step 7: Run the SDK tests, lint, typecheck**

Run: `pnpm exec nx run-many -t test lint typecheck --projects=@themoltnet/sdk`
Expected: the register tests pass. Typecheck fails only in `apps/agent-daemon`
(fixed in Task 4), which is not in this run; if `nx` pulls it in through project
references, note it and continue.

- [ ] **Step 8: Diary entry and commit**

```bash
git add libs/sdk/src/errors.ts libs/sdk/src/register.ts libs/sdk/src/agent.ts libs/sdk/src/namespaces/agents.ts libs/sdk/src/index.ts libs/sdk/__tests__/register.test.ts
moltnet entry commit --diary-id 6e4d9948-8ec5-4f59-b82a-3acbc4bbc396 --risk medium --scope "sdk,auth" --operator edouard --tool claude --title "refactor(sdk): make the in-memory registration request internal" --rationale "The in-memory registration becomes requestRegistration, exported from its module for tests but no longer from the package root, and accepts a prepared keypair so the persisting register can store the seed before the network call. Adds RegisterIdentityError with the codes the persisting flow reports, and agents.updateWhoami so alias publication has an SDK call. The daemon is updated in a following commit."
git commit -m "refactor(sdk): make the in-memory registration request internal" -m "MoltNet-Diary: <entryId>
Task-Group: sdk-register-identity-store

Claude-Session: https://claude.ai/code/session_015FWKhcNAMs5RKTEkA3bLsS"
```

---

### Task 3: `register()` and `enroll()` in `@themoltnet/sdk/node`

**Files:**

- Create: `libs/sdk/src/register-node.ts`
- Modify: `libs/sdk/src/node.ts`
- Create: `libs/sdk/__tests__/register-node.test.ts`

**Interfaces:**

- Consumes: `requestRegistration`, `RegisterIdentityError`,
  `agents.updateWhoami` (Task 2); `writeConfig`, `getIdentityDir`,
  `assertIdentityAlias`, `identitySeedKey`, `oauth2SecretKey`, `agentKeyKey`,
  `deriveMcpUrl` from `./credentials.js`; `connect` from `./connect.js`;
  `SecretProvider` from `./secrets.js`; `OSKeyringSecretProvider` from
  `./node.js`.
- Produces:

  ```ts
  export type ConnectForRegistration = (
    options: ConnectOptions,
  ) => Promise<Pick<Agent, 'agents'>>;
  export interface RegisterOptions {
    name: string;
    apiUrl?: string;
    credentialType?: 'oauth2' | 'agent_key';
    enrollmentToken?: string;
    secretProvider?: SecretProvider;
    configDir?: string;
    publishAlias?: boolean;
    signal?: AbortSignal;
    /** Test seam and daemon injection; defaults to the in-memory connect. */
    connectAgent?: ConnectForRegistration;
  }
  export interface RegisterResult {
    alias: string;
    configPath: string;
    config: MoltNetConfig;
    identity: { subjectId: string; publicKey: string; fingerprint: string };
    whoami: Whoami;
    aliasPublished: boolean;
  }
  export function register(options: RegisterOptions): Promise<RegisterResult>;
  export function enroll(
    options: RegisterOptions & { enrollmentToken: string },
  ): Promise<RegisterResult>;
  ```

- [ ] **Step 1: Write the failing tests**

Create `libs/sdk/__tests__/register-node.test.ts`:

```ts
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { enrollAgent, registerAgent } from '@moltnet/api-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MoltNetError,
  NetworkError,
  RegisterIdentityError,
} from '../src/errors.js';
import { FileSecretProvider, register } from '../src/node.js';
import {
  agentKeyKey,
  identitySeedKey,
  oauth2SecretKey,
  READ_WRITE_CAPABILITIES,
  type SecretProvider,
} from '../src/secrets.js';

vi.mock('@moltnet/crypto-service', () => ({
  cryptoService: {
    generateKeyPair: vi.fn().mockResolvedValue({
      publicKey: 'ed25519:dGVzdHB1YmtleQ==',
      privateKey: 'dGVzdHByaXZrZXk=',
      fingerprint: 'ABCD-1234-EF56-7890',
    }),
    sign: vi.fn().mockResolvedValue('registration-proof'),
  },
}));

vi.mock('@moltnet/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@moltnet/api-client')>()),
  createClient: vi.fn().mockReturnValue({}),
  enrollAgent: vi.fn(),
  registerAgent: vi.fn(),
}));

const oauthResponse = {
  agentId: 'agent-123',
  identityId: 'uuid-123',
  fingerprint: 'ABCD-1234-EF56-7890',
  publicKey: 'ed25519:dGVzdHB1YmtleQ==',
  credential: {
    type: 'oauth2' as const,
    clientId: 'client-id',
    clientSecret: 'client-secret',
  },
};
const agentKeyResponse = {
  ...oauthResponse,
  credential: {
    type: 'agent_key' as const,
    key: { id: 'key-1' },
    secret: 'agent-key-secret',
  },
};
const whoami = {
  subjectId: 'agent-123',
  subjectType: 'agent' as const,
  identityId: 'uuid-123',
  publicKey: 'ed25519:dGVzdHB1YmtleQ==',
  fingerprint: 'ABCD-1234-EF56-7890',
};
const success = (data: unknown) =>
  ({
    data,
    error: undefined,
    request: new Request('http://localhost'),
    response: new Response(),
  }) as never;

const roots: string[] = [];
async function freshRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sdk-register-'));
  roots.push(root);
  return root;
}

function fakeConnect(
  overrides: { whoami?: unknown; updateWhoami?: unknown } = {},
) {
  const whoamiFn = vi.fn().mockResolvedValue(overrides.whoami ?? whoami);
  const updateWhoamiFn = vi.fn().mockResolvedValue(
    overrides.updateWhoami ?? {
      subjectId: 'agent-123',
      fingerprint: whoami.fingerprint,
      alias: 'reg-test',
    },
  );
  const connectAgent = vi.fn().mockResolvedValue({
    agents: {
      whoami: whoamiFn,
      updateWhoami: updateWhoamiFn,
      lookup: vi.fn(),
      verifySignature: vi.fn(),
    },
  });
  return { connectAgent, whoamiFn, updateWhoamiFn };
}

function memoryProvider(
  failOn?: (key: string) => boolean,
): SecretProvider & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    name: 'memory',
    capabilities: READ_WRITE_CAPABILITIES,
    values,
    read: (key) => Promise.resolve(values.get(key) ?? null),
    write: (key, value) => {
      if (failOn?.(key))
        return Promise.reject(new Error('simulated store failure'));
      values.set(key, value);
      return Promise.resolve();
    },
    delete: (key) => {
      values.delete(key);
      return Promise.resolve();
    },
    probe: (key) => Promise.resolve(values.has(key) ? 'present' : 'absent'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe('register (node)', () => {
  it('stores the seed and OAuth2 secret as references and writes the canonical config', async () => {
    vi.mocked(registerAgent).mockResolvedValue(success(oauthResponse));
    const root = await freshRoot();
    const configDir = join(root, 'identities', 'reg-test');
    const provider = memoryProvider();
    const { connectAgent, updateWhoamiFn } = fakeConnect();

    const result = await register({
      name: 'reg-test',
      apiUrl: 'https://api.example.test',
      secretProvider: provider,
      configDir,
      connectAgent,
    });

    expect(result.configPath).toBe(join(configDir, 'moltnet.json'));
    expect(result.config).toEqual({
      subject_id: 'agent-123',
      subject_type: 'agent',
      registered_at: result.config.registered_at,
      oauth2: {
        client_id: 'client-id',
        client_secret_ref: {
          provider: 'memory',
          key: oauth2SecretKey('agent-123', 'client-id'),
        },
      },
      keys: {
        public_key: 'ed25519:dGVzdHB1YmtleQ==',
        fingerprint: 'ABCD-1234-EF56-7890',
        private_key_ref: {
          provider: 'memory',
          key: identitySeedKey('ABCD-1234-EF56-7890'),
        },
      },
      endpoints: {
        api: 'https://api.example.test',
        mcp: 'https://api.example.test/mcp',
      },
    });
    const raw = await readFile(result.configPath, 'utf-8');
    expect(raw).not.toContain('client-secret');
    expect(raw).not.toContain('dGVzdHByaXZrZXk=');
    expect(provider.values.get(identitySeedKey('ABCD-1234-EF56-7890'))).toBe(
      'dGVzdHByaXZrZXk=',
    );
    expect(provider.values.get(oauth2SecretKey('agent-123', 'client-id'))).toBe(
      'client-secret',
    );
    expect(
      JSON.parse(await readFile(join(root, 'identity-selector.json'), 'utf-8')),
    ).toEqual({
      version: 1,
      default_identity: 'reg-test',
    });
    expect(connectAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-id',
        clientSecret: 'client-secret',
        apiUrl: 'https://api.example.test',
      }),
    );
    expect(updateWhoamiFn).toHaveBeenCalledWith(
      { alias: 'reg-test' },
      expect.anything(),
    );
    expect(result.aliasPublished).toBe(true);
    expect(result.whoami).toEqual(whoami);
  });

  it('enrolls with an agent key, stores it, and skips alias publication', async () => {
    vi.mocked(enrollAgent).mockResolvedValue(success(agentKeyResponse));
    const root = await freshRoot();
    const provider = memoryProvider();
    const { connectAgent, updateWhoamiFn } = fakeConnect();

    const result = await register({
      name: 'managed',
      apiUrl: 'https://api.example.test',
      credentialType: 'agent_key',
      enrollmentToken: 'A'.repeat(43),
      secretProvider: provider,
      configDir: join(root, 'identities', 'managed'),
      connectAgent,
    });

    expect(result.config.agent_key_ref).toEqual({
      provider: 'memory',
      key: agentKeyKey('agent-123'),
    });
    expect(result.config).not.toHaveProperty('oauth2');
    expect(provider.values.get(agentKeyKey('agent-123'))).toBe(
      'agent-key-secret',
    );
    expect(connectAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentKey: 'agent-key-secret' }),
    );
    expect(updateWhoamiFn).not.toHaveBeenCalled();
    expect(result.aliasPublished).toBe(false);
  });

  it('refuses an alias whose config already exists before any network call', async () => {
    const root = await freshRoot();
    const configDir = join(root, 'identities', 'taken');
    await writeFile(join(configDir, 'moltnet.json'), '{}').catch(async () => {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(configDir, { recursive: true });
      await writeFile(join(configDir, 'moltnet.json'), '{}');
    });

    await expect(
      register({
        name: 'taken',
        apiUrl: 'https://api.example.test',
        secretProvider: memoryProvider(),
        configDir,
        connectAgent: fakeConnect().connectAgent,
      }),
    ).rejects.toMatchObject({ code: 'alias_exists' });
    expect(registerAgent).not.toHaveBeenCalled();
  });

  it('fails before registering when the provider cannot store', async () => {
    const root = await freshRoot();
    await expect(
      register({
        name: 'no-provider',
        apiUrl: 'https://api.example.test',
        secretProvider: memoryProvider(() => true),
        configDir: join(root, 'identities', 'no-provider'),
        connectAgent: fakeConnect().connectAgent,
      }),
    ).rejects.toMatchObject({ code: 'provider_unavailable' });
    expect(registerAgent).not.toHaveBeenCalled();
  });

  it('removes the seed and writes nothing when the server rejects the registration', async () => {
    vi.mocked(registerAgent).mockResolvedValue({
      data: undefined,
      error: {
        type: 'urn:moltnet:problem:registration-failed',
        title: 'Registration failed',
        status: 403,
      },
    } as never);
    const root = await freshRoot();
    const configDir = join(root, 'identities', 'rejected');
    const provider = memoryProvider();

    await expect(
      register({
        name: 'rejected',
        apiUrl: 'https://api.example.test',
        secretProvider: provider,
        configDir,
        connectAgent: fakeConnect().connectAgent,
      }),
    ).rejects.toMatchObject({ code: 'registration_failed', statusCode: 403 });
    expect(provider.values.size).toBe(0);
    await expect(stat(join(configDir, 'moltnet.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('keeps the seed when the transport fails after the replay', async () => {
    vi.mocked(registerAgent).mockRejectedValue(
      new TypeError('connection reset'),
    );
    const root = await freshRoot();
    const provider = memoryProvider();

    await expect(
      register({
        name: 'lost',
        apiUrl: 'https://api.example.test',
        secretProvider: provider,
        configDir: join(root, 'identities', 'lost'),
        connectAgent: fakeConnect().connectAgent,
      }),
    ).rejects.toBeInstanceOf(NetworkError);
    expect(provider.values.get(identitySeedKey('ABCD-1234-EF56-7890'))).toBe(
      'dGVzdHByaXZrZXk=',
    );
  });

  it('leaves a recoverable config when the credential secret cannot be stored', async () => {
    vi.mocked(registerAgent).mockResolvedValue(success(oauthResponse));
    const root = await freshRoot();
    const configDir = join(root, 'identities', 'flaky');
    const provider = memoryProvider(
      (key) => key === oauth2SecretKey('agent-123', 'client-id'),
    );

    const failure = await register({
      name: 'flaky',
      apiUrl: 'https://api.example.test',
      secretProvider: provider,
      configDir,
      connectAgent: fakeConnect().connectAgent,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RegisterIdentityError);
    expect(failure).toMatchObject({
      code: 'registration_incomplete',
      subjectId: 'agent-123',
      fingerprint: 'ABCD-1234-EF56-7890',
      configPath: join(configDir, 'moltnet.json'),
      recoveryCommand: expect.stringContaining(
        'moltnet agents credentials recover --yes',
      ),
    });
    const config = JSON.parse(
      await readFile(join(configDir, 'moltnet.json'), 'utf-8'),
    ) as Record<string, unknown>;
    expect(config).toMatchObject({
      subject_id: 'agent-123',
      oauth2: { client_id: 'client-id' },
    });
    expect(provider.values.get(identitySeedKey('ABCD-1234-EF56-7890'))).toBe(
      'dGVzdHByaXZrZXk=',
    );
  });

  it('rejects when the authenticated whoami names a different identity', async () => {
    vi.mocked(registerAgent).mockResolvedValue(success(oauthResponse));
    const root = await freshRoot();
    const { connectAgent } = fakeConnect({
      whoami: { ...whoami, fingerprint: 'ZZZZ-0000-0000-0000' },
    });

    await expect(
      register({
        name: 'mismatch',
        apiUrl: 'https://api.example.test',
        secretProvider: memoryProvider(),
        configDir: join(root, 'identities', 'mismatch'),
        connectAgent,
      }),
    ).rejects.toMatchObject({ code: 'identity_mismatch' });
  });

  it('reports a failed alias publication without failing registration', async () => {
    vi.mocked(registerAgent).mockResolvedValue(success(oauthResponse));
    const root = await freshRoot();
    const { connectAgent, updateWhoamiFn } = fakeConnect();
    updateWhoamiFn.mockRejectedValueOnce(
      new MoltNetError('forbidden', { code: 'FORBIDDEN', statusCode: 403 }),
    );

    const result = await register({
      name: 'unpublished',
      apiUrl: 'https://api.example.test',
      secretProvider: memoryProvider(),
      configDir: join(root, 'identities', 'unpublished'),
      connectAgent,
    });

    expect(result.aliasPublished).toBe(false);
  });

  it('defaults to the OS keyring provider and the identities directory', async () => {
    // Only the defaults are checked here; the keyring adapter is never loaded.
    const { OSKeyringSecretProvider } = await import('../src/node.js');
    const { getIdentityDir } = await import('../src/credentials.js');
    expect(new OSKeyringSecretProvider().name).toBe('os-keyring');
    expect(
      getIdentityDir('reg-test').endsWith(join('identities', 'reg-test')),
    ).toBe(true);
  });
});
```

The last test uses `await import()`; replace it with static imports at the top
(`OSKeyringSecretProvider` from `../src/node.js`, `getIdentityDir` from
`../src/credentials.js`) before running, and use a `mkdir` static import in the
alias-exists test instead of the inline dynamic import. Dynamic imports in tests
are forbidden by the repo rules; the sketch above only marks where the values
come from.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec nx run @themoltnet/sdk:test -- __tests__/register-node.test.ts`
Expected: FAIL, `register` is not exported from `../src/node.js`.

- [ ] **Step 3: Implement `register-node.ts`**

Create `libs/sdk/src/register-node.ts`:

```ts
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { cryptoService } from '@moltnet/crypto-service';

import type { Agent, Whoami } from './agent.js';
import {
  normalizeOptionalApiUrl,
  requireSecureCredentialApiUrl,
} from './api-url.js';
import { connect, type ConnectOptions } from './connect.js';
import {
  agentKeyKey,
  assertIdentityAlias,
  deriveMcpUrl,
  getIdentityDir,
  identitySeedKey,
  type MoltNetConfig,
  oauth2SecretKey,
  writeConfig,
} from './credentials.js';
import { MoltNetError, NetworkError, RegisterIdentityError } from './errors.js';
import {
  requestRegistration,
  type BootstrapCredentialType,
} from './register.js';
import type { SecretProvider } from './secrets.js';

export type ConnectForRegistration = (
  options: ConnectOptions,
) => Promise<Pick<Agent, 'agents'>>;

export interface RegisterOptions {
  /** Identity alias; becomes the directory name and the published network alias. */
  name: string;
  apiUrl?: string;
  /** Default `oauth2`. Agent keys are what the daemon's managed agents use. */
  credentialType?: BootstrapCredentialType;
  /** Redeem this token into its issuing team instead of self-registering. */
  enrollmentToken?: string;
  /** Where the seed and the credential secret are stored. Default: OS keyring. */
  secretProvider?: SecretProvider;
  /** Identity directory. Default: `<config dir>/identities/<name>`. */
  configDir?: string;
  /** Publish `name` as the network alias. Default true for OAuth2; never for agent keys. */
  publishAlias?: boolean;
  signal?: AbortSignal;
  /** Connection factory for the post-registration whoami; defaults to the in-memory connect. */
  connectAgent?: ConnectForRegistration;
}

export interface RegisterResult {
  alias: string;
  configPath: string;
  config: MoltNetConfig;
  identity: { subjectId: string; publicKey: string; fingerprint: string };
  whoami: Whoami;
  aliasPublished: boolean;
}

const IDENTITY_OPERATION_TIMEOUT_MS = 15_000;

function boundedSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(IDENTITY_OPERATION_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function recoveryCommand(alias: string): string {
  return `MOLTNET_ACTIVE_IDENTITY=${alias} moltnet agents credentials recover --yes`;
}

async function preflightProvider(provider: SecretProvider): Promise<void> {
  if (!provider.capabilities.write || !provider.write || !provider.delete) {
    throw new RegisterIdentityError(
      'provider_unavailable',
      `secret provider "${provider.name}" cannot store secrets`,
    );
  }
  const key = `preflight/${process.pid}/${Date.now()}`;
  try {
    await provider.write(key, 'credential-store-preflight');
    await provider.delete(key);
  } catch (cause) {
    throw new RegisterIdentityError(
      'provider_unavailable',
      `secret provider "${provider.name}" is unavailable; registration was not attempted`,
      { cause },
    );
  }
}

/**
 * Register an identity the way `moltnet register --name` does: seed stored
 * first, config written with references right after the server commits,
 * credential secret stored last, then verified with an authenticated whoami.
 * A failure after the commit leaves everything needed for
 * `moltnet agents credentials recover --yes`.
 */
export async function register(
  options: RegisterOptions,
): Promise<RegisterResult> {
  const alias = assertIdentityAlias(options.name);
  const credentialType = options.credentialType ?? 'oauth2';
  const apiUrl = requireSecureCredentialApiUrl(
    normalizeOptionalApiUrl(options.apiUrl),
  );
  const configDir = options.configDir ?? getIdentityDir(alias);
  const configPath = join(configDir, 'moltnet.json');
  const connectAgent = options.connectAgent ?? connect;
  const provider = options.secretProvider ?? (await defaultProvider());

  if (await exists(configPath)) {
    throw new RegisterIdentityError(
      'alias_exists',
      `identity "${alias}" already exists at ${configPath}`,
      { configPath },
    );
  }
  await preflightProvider(provider);
  const write = provider.write!;

  const keyPair = await cryptoService.generateKeyPair();
  const seedRef = {
    provider: provider.name,
    key: identitySeedKey(keyPair.fingerprint),
  };
  try {
    await write(seedRef.key, keyPair.privateKey);
  } catch (cause) {
    throw new RegisterIdentityError(
      'provider_unavailable',
      `could not store the identity seed in "${provider.name}"; registration was not attempted`,
      { cause },
    );
  }

  let registration;
  try {
    registration = await requestRegistration({
      credentialType,
      enrollmentToken: options.enrollmentToken,
      apiUrl,
      keyPair,
      signal: options.signal,
    });
  } catch (cause) {
    if (
      cause instanceof MoltNetError &&
      !(cause instanceof NetworkError) &&
      cause.statusCode !== undefined &&
      cause.statusCode >= 400 &&
      cause.statusCode < 500
    ) {
      await provider.delete!(seedRef.key).catch(() => undefined);
      throw new RegisterIdentityError(
        'registration_failed',
        `registration for "${alias}" was rejected (${cause.statusCode}): ${cause.detail?.trim() || cause.message}`,
        {
          cause,
          statusCode: cause.statusCode,
          detail: cause.detail,
          fingerprint: keyPair.fingerprint,
        },
      );
    }
    // Transport failure after the replay: the server may have committed.
    // The seed stays so the identity can still be recovered by fingerprint.
    throw cause;
  }

  const { subjectId, fingerprint } = registration.identity;
  const credentials = registration.credentials;
  if (credentials.type !== credentialType) {
    throw new RegisterIdentityError(
      'unsupported_credential',
      `registration returned credential type "${credentials.type}", expected "${credentialType}"`,
      { subjectId, fingerprint, recoveryCommand: recoveryCommand(alias) },
    );
  }

  const base = {
    subject_id: subjectId,
    subject_type: 'agent' as const,
    registered_at: new Date().toISOString(),
    keys: {
      public_key: keyPair.publicKey,
      fingerprint,
      private_key_ref: seedRef,
    },
    endpoints: {
      api: registration.apiUrl,
      mcp: deriveMcpUrl(registration.apiUrl),
    },
  };
  const credentialRef =
    credentials.type === 'oauth2'
      ? {
          provider: provider.name,
          key: oauth2SecretKey(subjectId, credentials.clientId),
        }
      : { provider: provider.name, key: agentKeyKey(subjectId) };
  const config: MoltNetConfig =
    credentials.type === 'oauth2'
      ? {
          ...base,
          oauth2: {
            client_id: credentials.clientId,
            client_secret_ref: credentialRef,
          },
        }
      : { ...base, agent_key_ref: credentialRef };

  const incomplete = (message: string, cause?: unknown) =>
    new RegisterIdentityError(
      'registration_incomplete',
      `${message}; ${recoveryCommand(alias)} completes it`,
      {
        cause,
        subjectId,
        fingerprint,
        configPath,
        recoveryCommand: recoveryCommand(alias),
      },
    );

  try {
    await writeConfig(config, configDir);
  } catch (cause) {
    throw incomplete(
      `the agent ${subjectId} is registered and its seed is stored, but the config could not be written`,
      cause,
    );
  }
  try {
    await write(
      credentialRef.key,
      credentials.type === 'oauth2'
        ? credentials.clientSecret
        : credentials.secret,
    );
  } catch (cause) {
    throw incomplete(
      `the agent ${subjectId} is registered and its config is written, but the credential secret could not be stored`,
      cause,
    );
  }

  let agents: Pick<Agent, 'agents'>['agents'];
  let whoami: Whoami;
  const signal = boundedSignal(options.signal);
  try {
    const connectOptions: ConnectOptions =
      credentials.type === 'oauth2'
        ? {
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            apiUrl: registration.apiUrl,
            signal,
          }
        : { agentKey: credentials.secret, apiUrl: registration.apiUrl, signal };
    agents = (await connectAgent(connectOptions)).agents;
    whoami = await agents.whoami({ signal });
  } catch (cause) {
    throw incomplete(
      `the agent ${subjectId} is registered and stored, but the authenticated whoami failed`,
      cause,
    );
  }
  if (
    whoami.subjectType !== 'agent' ||
    whoami.subjectId !== subjectId ||
    (whoami.publicKey !== undefined &&
      whoami.publicKey !== keyPair.publicKey) ||
    (whoami.fingerprint !== undefined && whoami.fingerprint !== fingerprint)
  ) {
    throw new RegisterIdentityError(
      'identity_mismatch',
      `authenticated whoami does not match the registered identity ${subjectId}`,
      { subjectId, fingerprint, configPath },
    );
  }

  let aliasPublished = false;
  const publishAlias =
    credentials.type === 'oauth2' && options.publishAlias !== false;
  if (publishAlias) {
    try {
      const updated = await agents.updateWhoami({ alias }, { signal });
      aliasPublished = updated.subjectId === subjectId;
    } catch {
      aliasPublished = false;
    }
  }

  return {
    alias,
    configPath,
    config,
    identity: { subjectId, publicKey: keyPair.publicKey, fingerprint },
    whoami,
    aliasPublished,
  };
}

/** `register()` with a required enrollment token: the identity joins the issuing team. */
export function enroll(
  options: RegisterOptions & { enrollmentToken: string },
): Promise<RegisterResult> {
  return register(options);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function defaultProvider(): Promise<SecretProvider> {
  // Imported lazily through node.ts to keep this module free of the keyring
  // adapter until a caller relies on the default.
  const { OSKeyringSecretProvider } = await import('./node.js');
  return new OSKeyringSecretProvider();
}
```

Then remove the `defaultProvider` dynamic import: `node.ts` will import from
this file, so importing `node.ts` back creates a cycle. Instead, give
`register-node.ts` a module-level setter used by `node.ts`:

```ts
let defaultProviderFactory: (() => SecretProvider) | undefined;
/** Set once by the /node entry so `register()` defaults to the OS keyring. */
export function setDefaultRegistrationSecretProvider(
  factory: () => SecretProvider,
): void {
  defaultProviderFactory = factory;
}
async function defaultProvider(): Promise<SecretProvider> {
  if (!defaultProviderFactory) {
    throw new RegisterIdentityError(
      'provider_unavailable',
      'no default secret provider; pass secretProvider',
    );
  }
  return defaultProviderFactory();
}
```

In `libs/sdk/src/node.ts`, after the `OSKeyringSecretProvider` class, add:

```ts
import {
  enroll,
  register,
  type RegisterOptions,
  type RegisterResult,
  setDefaultRegistrationSecretProvider,
} from './register-node.js';

setDefaultRegistrationSecretProvider(() => new OSKeyringSecretProvider());

export { enroll, register, type RegisterOptions, type RegisterResult };
export {
  RegisterIdentityError,
  type RegisterIdentityErrorCode,
} from './errors.js';
```

Place the import with the other imports at the top of the file (ESLint import
ordering) and the `setDefault...` call after the class declaration.

- [ ] **Step 4: Run the tests, lint, typecheck**

Run: `pnpm exec nx run-many -t test lint typecheck --projects=@themoltnet/sdk`
Expected: all SDK tests pass. The `MoltNetConfig` union may need the
`oauth2`/`agent_key_ref` objects typed as `OAuth2Config`/`SecretReference`
explicitly; import those types from `./credentials.js` if the literal does not
narrow.

- [ ] **Step 5: Diary entry and commit**

```bash
git add libs/sdk/src/register-node.ts libs/sdk/src/node.ts libs/sdk/__tests__/register-node.test.ts
moltnet entry commit --diary-id 6e4d9948-8ec5-4f59-b82a-3acbc4bbc396 --risk high --scope "sdk,auth" --operator edouard --tool claude --title "feat(sdk): register writes the identity store like the CLI" --rationale "register() from @themoltnet/sdk/node now does what moltnet register does: preflights the secret provider, stores the seed before the network call, writes the canonical config with both references right after the server commits, stores the credential secret last, verifies the identity with an authenticated whoami, and publishes the alias for OAuth2 identities. A server rejection deletes the seed and keeps nothing; any failure after the commit throws registration_incomplete carrying the subject id, config path, and the recovery command. enroll() is the token-carrying form. The OS keyring is the default provider through the node entry."
git commit -m "feat(sdk): register writes the identity store like the CLI" -m "MoltNet-Diary: <entryId>
Task-Group: sdk-register-identity-store

Claude-Session: https://claude.ai/code/session_015FWKhcNAMs5RKTEkA3bLsS"
```

---

### Task 4: The daemon delegates managed-agent creation to `register()`

**Files:**

- Modify: `apps/agent-daemon/src/lib/agent-server/identity.ts:11-46,115-257`
- Modify:
  `apps/agent-daemon/src/lib/agent-server/identity.test.ts:1-135,204-455`

**Interfaces:**

- Consumes: `register`, `RegisterIdentityError` from `@themoltnet/sdk/node`
  (Task 3).
- Produces: unchanged `createManagedAgent(store, secrets, input, connectAgent?)`
  signature and error codes.

- [ ] **Step 1: Rewrite the daemon tests' mocks**

In `identity.test.ts`, replace the `vi.hoisted` block and the two `vi.mock`
calls at lines 33-45 with:

```ts
const { connectMock, enrollMock } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  enrollMock: vi.fn(),
}));

vi.mock('@moltnet/crypto-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@moltnet/crypto-service')>()),
  cryptoService: {
    generateKeyPair: vi.fn().mockResolvedValue({
      publicKey: 'ed25519:public',
      privateKey: 'private-seed',
      fingerprint: 'FP-1',
    }),
    sign: vi.fn().mockResolvedValue('registration-proof'),
    verify: vi.fn().mockResolvedValue(true),
  },
}));
vi.mock('@moltnet/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@moltnet/api-client')>()),
  createClient: vi.fn().mockReturnValue({}),
  enrollAgent: enrollMock,
}));
vi.mock('@themoltnet/sdk/node', async (importOriginal) => ({
  ...(await importOriginal<typeof SdkNode>()),
  connect: connectMock,
}));
```

Replace `registerMock.mockResolvedValue({...})` in `beforeEach` with:

```ts
enrollMock.mockResolvedValue({
  data: {
    agentId: 'agent-1',
    identityId: 'identity-1',
    fingerprint: 'FP-1',
    publicKey: 'ed25519:public',
    credential: {
      type: 'agent_key',
      key: { id: 'key-1' },
      secret: 'agent-key-secret',
    },
  },
  error: undefined,
  request: new Request('http://localhost'),
  response: new Response(),
} as never);
```

Then adjust the managed-agent cases:

- Every `expect(registerMock)...` becomes `expect(enrollMock)...`.
- `'reserves an alias while registration is in flight'`: the
  `mockImplementationOnce` returns the `enrollMock` payload shape above (same
  `data`/`error` wrapper) after `await finish`.
- `'explicitly abandons incomplete local registration artifacts'`: replace
  `vi.spyOn(secrets, 'write').mockRejectedValueOnce(new Error('disk full'));`
  with

  ```ts
  const realWrite = secrets.write.bind(secrets);
  vi.spyOn(secrets, 'write').mockImplementation((key, value) =>
    key.startsWith('agent-key/')
      ? Promise.reject(new Error('disk full'))
      : realWrite(key, value),
  );
  ```

  so the preflight and the seed write still succeed and only the credential
  write fails.

- `'blocks retry when registration fails after its durable reservation'`:
  `enrollMock.mockRejectedValueOnce(new TypeError('response lost'))` twice in a
  row is needed because the SDK replays once: use
  `.mockRejectedValueOnce(...).mockRejectedValueOnce(...)`.
- `'clears the reservation after a definitive registration rejection'`: replace
  the `MoltNetError` rejection with a problem result:
  `enrollMock.mockResolvedValueOnce({ data: undefined, error: { type: 'urn:moltnet:problem:invalid-token', title: 'bad enrollment token', status: 400, detail: 'bad enrollment token' } } as never);`
  and keep the expected message
  `'registration for "retryable" was rejected (400): bad enrollment token'`.
- `'persists an exact agent-key-only MoltNetConfig without secret values'`:
  unchanged assertions; they already match what `register()` writes.

- [ ] **Step 2: Run the daemon tests to verify the managed cases fail**

Run:
`pnpm exec nx run @themoltnet/agent-daemon:test -- src/lib/agent-server/identity.test.ts`
Expected: managed-agent cases FAIL (the daemon still calls the removed root
`register`, so this may surface as a typecheck or import error), external cases
pass.

- [ ] **Step 3: Delegate in `createManagedAgent`**

In `identity.ts`, change the imports: remove `register`, `agentKeyKey`,
`identitySeedKey`, `deriveMcpUrl` from the `@themoltnet/sdk` import (keep what
`verify*`/`attach*` still use; run typecheck to confirm), and import from
`@themoltnet/sdk/node`:

```ts
import {
  connect,
  type ConnectOptions,
  FILE_SECRET_PROVIDER,
  type FileSecretProvider,
  register,
  RegisterIdentityError,
} from '@themoltnet/sdk/node';
```

Replace the body of `createManagedAgent` from
`const releaseAlias = reserveAlias(store, alias);` through the end of the
function with:

```ts
const releaseAlias = reserveAlias(store, alias);
try {
  let apiUrl: string;
  try {
    apiUrl = requireSecureCredentialApiUrl(input.apiUrl);
  } catch (cause) {
    throw new AgentServerIdentityError(
      'registration_failed',
      'registration API URL must use HTTPS or HTTP loopback',
      { cause },
    );
  }
  // This durable marker prevents a retry from creating a second remote
  // identity if registration commits but its response or a local write fails.
  store.reserveRegistration(alias, apiUrl);
  let registered;
  try {
    registered = await register({
      name: alias,
      apiUrl,
      credentialType: 'agent_key',
      enrollmentToken: input.enrollmentToken,
      secretProvider: secrets,
      configDir: store.identityDir(alias),
      publishAlias: false,
      signal: input.signal,
      connectAgent,
    });
  } catch (cause) {
    if (
      cause instanceof RegisterIdentityError &&
      cause.code === 'registration_failed'
    ) {
      store.clearPendingRegistration(alias);
      throw new AgentServerIdentityError('registration_failed', cause.message, {
        cause,
      });
    }
    if (
      cause instanceof RegisterIdentityError &&
      cause.code === 'unsupported_credential'
    ) {
      throw new AgentServerIdentityError(
        'unsupported_credential',
        cause.message,
        { cause },
      );
    }
    throw new AgentServerIdentityError(
      'registration_incomplete',
      cause instanceof RegisterIdentityError &&
        cause.code === 'registration_incomplete'
        ? `the remote agent was registered but local activation is incomplete; reconcile or clear its pending Agent Server record before retrying`
        : `registration for "${alias}" may be incomplete; inspect the remote API before changing its pending Agent Server record`,
      { cause },
    );
  }

  const { config, whoami, identity } = registered;
  assertIdentityMatches(
    whoami,
    { publicKey: identity.publicKey, fingerprint: identity.fingerprint },
    'authenticated whoami',
    `new managed agent "${alias}"`,
  );
  const boundTeamId = boundTeamIdFromWhoami(whoami);
  const activation: AgentActivation = {
    alias,
    source: 'managed',
    subjectId: whoami.subjectId,
    publicKey: identity.publicKey,
    fingerprint: identity.fingerprint,
    ...(boundTeamId ? { boundTeamId } : {}),
    createdAt: config.registered_at,
    apiUrl: registration_api(config),
  };
  store.writeActivation(activation);
  return { activation, config, ...(boundTeamId ? { boundTeamId } : {}) };
} catch (cause) {
  if (cause instanceof AgentServerIdentityError) throw cause;
  if (store.hasPendingRegistration(alias)) {
    throw new AgentServerIdentityError(
      'registration_incomplete',
      `the remote agent was registered but local activation is incomplete; reconcile or clear its pending Agent Server record before retrying`,
      { cause },
    );
  }
  throw cause;
} finally {
  releaseAlias();
}
```

where `registration_api(config)` is simply `config.endpoints.api`; inline it.
The test
`'preserves a recovery record and blocks retry after partial persistence'` spies
on `writeActivation` throwing `'disk full'`, which the outer `catch` maps to
`registration_incomplete` because the pending marker is still set. Delete the
now-unused `registrationRejectionMessage` helper and the
`now`/`agentKeyReference`/`seedReference` locals. The `unsupported_credential`
mapping for a wrong credential type stays through the SDK error.

Keep `reconcileManagedRegistration` unchanged: it reads the config `register()`
wrote (same shape) and the same secret keys.

- [ ] **Step 4: Run the daemon tests, lint, typecheck**

Run:
`pnpm exec nx run-many -t test lint typecheck --projects=@themoltnet/agent-daemon`
Expected: success. If the `createManagedAgent` signature's
`secrets: FileSecretProvider` no longer needs the concrete class, keep it;
`FileSecretProvider` satisfies `SecretProvider`.

- [ ] **Step 5: Smoke run against the e2e stack**

With the e2e stack up (`pnpm run e2e:up`), start a throwaway agent server root
and create a managed agent through the daemon API. Follow
`apps/agent-daemon/README.md` "local development & smoke testing" for the
bootstrap of a project team and an enrollment token, then:

```bash
MOLTNET_AGENT_SERVER_ROOT=$(mktemp -d) pnpm exec nx run @themoltnet/agent-daemon:serve -- server
# In another shell, pair through the Console or curl the loopback API per the README, then
# POST /v1/agents { "kind": "managed", "name": "smoke-agent", "apiUrl": "http://127.0.0.1:8080", "enrollmentToken": "<token>" }
```

Expected: `201` with `hasAgentKey: true` and `hasPrivateKey: true`;
`<root>/identities/smoke-agent/moltnet.json` holds references only;
`<root>/identity-selector.json` names `smoke-agent`. If pairing cannot be
completed non-interactively, record that in the PR and rely on the unit suite.

- [ ] **Step 6: Diary entry and commit**

```bash
git add apps/agent-daemon/src/lib/agent-server/identity.ts apps/agent-daemon/src/lib/agent-server/identity.test.ts
moltnet entry commit --diary-id 6e4d9948-8ec5-4f59-b82a-3acbc4bbc396 --risk high --scope "agent-daemon,sdk" --operator edouard --tool claude --title "refactor(agent-daemon): create managed agents through the SDK register" --rationale "createManagedAgent keeps alias reservation, the durable pending-registration marker, and the activation record, and delegates keypair, config, secret storage, and whoami verification to register() from the SDK node entry with the file secret provider and the store's identity directory. Error mapping is unchanged: a server rejection clears the marker, anything after the commit stays pending for reconcile. The tests now mock the API client and the crypto service instead of the SDK register, so they exercise the real persistence path against a temp store."
git commit -m "refactor(agent-daemon): create managed agents through the SDK register" -m "MoltNet-Diary: <entryId>
Task-Group: sdk-register-identity-store
Task-Completes: true

Claude-Session: https://claude.ai/code/session_015FWKhcNAMs5RKTEkA3bLsS"
```

---

### Task 5: Pull request

- [ ] **Step 1: Push and open the PR against PR 2's branch**

```bash
git push -u origin feat/sdk-register-identity-store
moltnet github exec -- gh pr create --base fix/cli-register-seed-reference --head feat/sdk-register-identity-store \
  --title "feat(sdk): register writes the identity store like the CLI" \
  --body-file <body file>
```

The body lists the new node entry surface, the removed root exports, the daemon
delegation, the selector fix, and the verification commands; it ends with
`https://claude.ai/code/session_015FWKhcNAMs5RKTEkA3bLsS`.
