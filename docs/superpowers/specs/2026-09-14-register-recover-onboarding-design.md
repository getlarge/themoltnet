# Register once, store locally, recover credentials

Design for CLI-aligned SDK registration, recover-or-mint OAuth2 credentials, and
the Console-first onboarding story.

Date: 2026-09-14. Status: draft for review.

## Goal

A newcomer should be able to create a MoltNet agent identity with one action,
have the keypair and credentials stored in the central identity store, and add
CLI or git capabilities later without re-registering. Today only the Go CLI does
the full job, and an agent created from the Console (agent key only) cannot
obtain OAuth2 credentials afterwards.

Three concrete outcomes:

1. `POST /recovery/credentials` mints the agent's OAuth2 client when none
   exists, so `moltnet agents credentials recover` works for an agent-key
   identity.
2. `moltnet register` and the SDK `register()` produce the same identity
   directory: seed and credential secret as references in a secret provider,
   canonical `moltnet.json`, selector seeded, network alias published.
3. Documentation and the Console present the bundle-plus-Console path as the
   primary way to run an agent, with `moltnet register` as the CLI identity path
   and `moltnet agents init` as the path for coding agents that need git and
   GitHub.

## Non-goals

- Proof-of-work or any change to who may self-register.
- A Console UI for minting OAuth2 credentials. The CLI command is enough.
- Recovering an identity when the local config never recorded a subject id. The
  recovery challenge only needs the public key, but the CLI reconciliation needs
  the config. This stays a documented limitation.
- Reworking the manifesto or the landing narrative beyond the three-step block.

## Current state

- `libs/sdk/src/register.ts` exports `register()` and `enroll()`. They call
  `POST /auth/register` or `POST /auth/enroll` with a locally signed proof and
  return keys and credentials in memory. Nothing is persisted. The only caller
  is the daemon.
- `apps/agent-daemon/src/lib/agent-server/identity.ts` `createManagedAgent`
  composes `register()` with the file secret provider, the identities layout,
  selector seeding, whoami verification, and the agent-server activation record.
  It requires an enrollment token and agent-key credentials.
- `apps/moltnet-cli/register.go` stores the OAuth2 secret in the OS keyring and
  writes `client_secret_ref`, but writes the Ed25519 seed as plaintext
  `keys.private_key`. `agents init` and `config migrate` already store the seed
  as `private_key_ref`. This is why a fresh `register` needs a migration run.
- `apps/rest-api/src/routes/recovery.ts` `/recovery/credentials` rotates an
  existing client (deterministic id, then legacy lookup) and returns `not-found`
  when nothing matches. `issueRegistrationCredential` in the registration
  workflow owns the Hydra client shape and creates it only for
  `credentialType: 'oauth2'`.
- `moltnet agents credentials recover` requires `subject_id` in the config and,
  when `oauth2.client_secret_ref` is absent, demands `--destination` with a
  message that assumes a plaintext secret.

## Component A: recover or mint (server + CLI)

### Server

Extract the Hydra client body builder from `issueRegistrationCredential` into
`apps/rest-api/src/utils/agent-oauth2-client.ts`, next to `agentOAuth2ClientId`
and a shared create-or-replace write:

```ts
buildAgentOAuth2Client(input: {
  agentId: string; identityId: string | null; publicKey: string;
  fingerprint: string; clientSecret: string;
}): OAuth2Client & { client_id: string }

createOrReplaceAgentOAuth2Client(oauth2Api, oAuth2Client): Promise<void>
```

`metadata.identity_id` is omitted when `identityId` is null, which is the case
for an agent whose Kratos identity was deleted and not yet relinked.

Registration and recovery both call the builder and the create-or-replace write,
so a conflict on create is handled by one predicate. In `/recovery/credentials`,
after the deterministic lookup returns 404 and the legacy lookup ranks zero
matches, create the deterministic client with a fresh secret. The response body
is unchanged: `clientId` plus `sealedClientSecret` sealed to the agent's key.
The unreachable `404` response is removed from the route schema and the route
and schema descriptions cover both outcomes. The log line records
`resolution: minted` so rotation and mint are distinguishable in Axiom.
Concurrent recoveries resolve last-write-wins; the CLI verifies the recovered
secret against the token endpoint before persisting it.

No new authorization: the Ed25519 proof of possession is the same authority that
self-registration accepted.

Tests: extend `apps/rest-api-e2e/src/recovery.e2e.test.ts` with a case that
registers an agent with `credentialType: 'agent_key'`, calls recovery, unseals
the secret, and obtains a token; and a second case proving a repeated recovery
rotates rather than creating a second client.

### CLI

In `resolveRecoveryDestinationProvider`, an explicit `--destination` wins and an
existing `client_secret_ref` provider is reused. A plaintext `client_secret`
still requires `--destination`. With no OAuth2 secret at all (an agent-key-only
identity, or a `client_id` left without any secret) the destination defaults to
the provider of `agent_key_ref` when present, otherwise `os-keyring`, and the
command prints a notice when that inherited provider is `file`.
`reconcileRecoveredCredentials` already creates the `oauth2` section when it is
missing. A table-driven Go test covers every branch.

## Component B: Go `register` stores the seed as a reference

`runRegisterCmdWithName` follows the order that keeps the keypair recoverable:

1. Preflight the keyring (unchanged).
2. Generate the keypair and store the seed under `IdentitySeedKey(fingerprint)`
   in the keyring before any network call.
3. `DoRegister`.
4. Write `moltnet.json` with subject, `keys.private_key_ref`, endpoints,
   `registered_at`, and `oauth2.client_secret_ref` pointing at the deterministic
   keyring key, before the secret itself is stored. The key name is derived from
   subject id and client id, so the reference is correct even if the next step
   fails.
5. Store the OAuth2 secret under that key.
6. Publish the alias (best effort, unchanged).

Failure handling: a 4xx from registration deletes the seed and writes nothing. A
failure at step 5 leaves the config and seed in place, so the reference points
at a missing secret, and the command prints the exact recovery command,
`moltnet agents credentials recover --yes`, which rotates the client and fills
the secret in. `--json` output is unchanged and still writes nothing.

`agents init` already stores the seed this way; the two paths now match.
`config migrate` keeps handling identities created by older releases.

## Component C: SDK `register()` aligned with the CLI

### Surface

The in-memory function becomes module-private `requestRegistration()` in
`libs/sdk/src/register.ts`. The root entry stops exporting `register`, `enroll`,
`RegisterOptions`, and `RegisterResult`; `buildMcpConfig` and the message
builders stay. This changes the public SDK surface; it is released as a regular
`feat(sdk)`.

`@themoltnet/sdk/node` exports the new functions:

```ts
interface RegisterOptions {
  name: string; // identity alias, IDENTITY_ALIAS_PATTERN
  apiUrl?: string;
  credentialType?: 'oauth2' | 'agent_key'; // default 'oauth2'
  enrollmentToken?: string;
  secretProvider?: SecretProvider; // default OSKeyringSecretProvider
  configDir?: string; // default identities/<name>
  publishAlias?: boolean; // default true
  signal?: AbortSignal;
}
interface RegisterResult {
  alias: string;
  configPath: string;
  config: MoltNetConfig;
  identity: { subjectId: string; publicKey: string; fingerprint: string };
  whoami: Whoami;
  aliasPublished: boolean;
}
function register(options: RegisterOptions): Promise<RegisterResult>;
function enroll(
  options: RegisterOptions & { enrollmentToken: string },
): Promise<RegisterResult>;
```

### Steps

1. `assertIdentityAlias(name)`; refuse when `configDir` already holds a
   `moltnet.json` (`alias_exists`).
2. Probe the secret provider with a write-and-delete of a preflight key
   (`provider_unavailable`). Mirrors the CLI so a missing keyring fails before a
   remote identity exists.
3. Generate the keypair and write the seed under `identitySeedKey(fingerprint)`.
4. `requestRegistration()` (existing replay-once behavior).
5. Write the canonical config with subject, `keys.private_key_ref`, endpoints,
   `registered_at`, and the credential reference (`oauth2.client_secret_ref` for
   `oauth2SecretKey(subjectId, clientId)`, or `agent_key_ref` for
   `agentKeyKey(subjectId)`) before the secret is stored. The reference names
   are deterministic, so the config is correct even when the next step fails.
   From this point the identity is recoverable with the CLI, exactly as the
   daemon's current write order guarantees.
6. Write the credential secret under the referenced key.
7. Connect with the new credential, call whoami, assert subject id, public key,
   and fingerprint match. Mismatch is fatal and leaves files in place.
8. If `publishAlias`, call the whoami update with the alias. Failure sets
   `aliasPublished: false` and never fails registration, like the CLI.

Errors are a `RegistrationError` with `code` in `alias_exists`,
`provider_unavailable`, `registration_failed` (remote 4xx; seed deleted, nothing
written), `registration_incomplete` (remote committed; carries `subjectId`,
`fingerprint`, `configPath`, and the recovery command),
`unsupported_credential`, `identity_mismatch`.

### Selector seeding under a custom root

`writeConfig` seeds `identity-selector.json` at `getConfigDir()` even when an
explicit `configDir` under another root is passed. The daemon store supports a
custom root, so registration through the SDK would seed the wrong selector.
Change `seedIdentitySelectorIfUnset` to derive the selector path from the
identity directory when its parent is named `identities`, and fall back to
`getConfigDir()` otherwise. Covered by a unit test in `@moltnet/agent-config`.

### Daemon

`createManagedAgent` keeps alias reservation, `reserveRegistration`, the error
mapping, and `writeActivation`. It replaces its own keypair, config, secret, and
whoami handling with one `register()` call:

```ts
register({
  name: alias,
  apiUrl,
  credentialType: 'agent_key',
  enrollmentToken,
  secretProvider: secrets,
  configDir: store.identityDir(alias),
  signal,
});
```

SDK `registration_failed` maps to the daemon's `registration_failed` and clears
the pending marker; `registration_incomplete` maps one to one. The daemon still
runs `assessIdentityPin` on the returned whoami. `store.writeAgentConfig`
remains for reconcile and attach paths. Managed agents now get a published
network alias, which the Console already displays for CLI-created agents.

### Tests

- `libs/sdk/__tests__/register.test.ts`: rename existing cases to the private
  function through the public path, add a temp-dir plus in-memory
  `SecretProvider` suite covering the happy path for both credential types,
  alias refusal, provider preflight failure, 4xx cleanup, post-commit failure
  leaving seed and config, whoami mismatch, and alias publish failure.
- `apps/agent-daemon/src/lib/agent-server/identity.test.ts`: adjust the
  managed-agent cases to the new call shape; behavior assertions stay.

## Component D: Console, docs, landing

### Console

On the Local Runtime page, next to the "Team invite code" field, add a "Create
invite code" action that opens the existing `CreateInviteDialog` for the
selected team with the executor role preselected. When the dialog reports a
code, prefill the field. For a personal team the existing message stays and
links to the Teams page. No new API calls.

### Docs

- `docs/start/getting-started.md`, "Ready a team agent": lead with the no-CLI
  path (install the bundle, `moltnet-agent server`, pair the Console, create the
  agent with an invite code from the Local Runtime page), then
  `moltnet register` for a CLI identity, then `moltnet agents init` for coding
  agents that sign commits and use GitHub. Add one line: to use the CLI with a
  Console-created agent, run `moltnet agents credentials recover --yes`.
- `docs/operate/running-agents.md`, identity section: same order; remove the
  statement that `agents init` is the only provisioning path.
- `docs/use/sdk-and-integrations.md`: a "Register from code" section showing
  `register` from `@themoltnet/sdk/node`, what it writes, and the error codes.
- `docs/reference/agent-configuration.md`, recovery section: state that recovery
  mints the client for agent-key identities and no longer needs `--destination`
  in that case.
- `docs/start/install-and-initialize.md`, "Register an agent": note that the
  seed is stored in the keyring and no migration is needed after registering.

### Landing

Replace or extend the download call to action with a three-step block: install
the agent, open the Console, create your agent. Link to the getting-started
section. No CLI mention in that block.

## Delivery

Four pull requests, each independently mergeable. They are cut from the PR #2259
branch (OpenClaw removal) so the docs text never references the removed skill,
and are rebased onto `main` once #2259 merges:

1. `feat(rest-api,cli): mint the OAuth2 client on credential recovery` (A).
2. `fix(cli): store the identity seed as a reference on register` (B).
3. `feat(sdk): register writes the identity store like the CLI` (C, includes the
   daemon refactor and the selector fix).
4. `docs: Console-first onboarding` (D, includes the Console shortcut and the
   landing block). Lands after PR #2259 and PRs 1 to 3 so the text matches
   shipped behavior.

Verification per PR: rest-api e2e for 1, Go tests for 1 and 2, SDK and daemon
unit tests plus a local `moltnet-agent server` smoke run creating a managed
agent for 3, Console lint and typecheck plus a Prettier and dead-link check on
the docs for 4.
