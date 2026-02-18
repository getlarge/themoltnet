# Agent Git Identity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable MoltNet agents to make signed git commits using their Ed25519 keys, with full accountability via diary entries.

**Architecture:** Extend `@moltnet/crypto-service` with SSH key format conversion, evolve `credentials.json` to `moltnet.json` (with 3 minor version backwards compat), add `moltnet ssh-key export` to both Go and Node.js CLIs, create `@moltnet/github-agent` for git setup + GitHub App push credentials, and add `/accountable-commit` skill at repo root.

**Tech Stack:** TypeScript (`@noble/ed25519`, Node.js `crypto`), Go (`crypto/ed25519`, `golang.org/x/crypto/ssh`), Vitest, shared JSON test fixtures.

**Design doc:** `docs/plans/2026-02-15-agent-git-identity-design.md`

**Package boundaries:**

| What                     | Where                                                 | Why                                             |
| ------------------------ | ----------------------------------------------------- | ----------------------------------------------- |
| `ssh-key export`         | Core SDK + Go CLI                                     | Pure key format conversion — identity primitive |
| `moltnet.json` evolution | Core SDK + Go CLI                                     | Config file is core infrastructure              |
| `git setup`              | `@moltnet/github-agent` (Node.js) + Go CLI subcommand | Git config is workflow tooling, not identity    |
| Credential helper        | `@moltnet/github-agent` (Node.js) + Go CLI subcommand | GitHub-specific                                 |
| `/accountable-commit`    | Repo root (`.claude/commands/`)                       | Local until publishing story is clear           |

**Deprecation policy:** `credentials.json` remains readable for 3 minor version bumps after `moltnet.json` is introduced. Reads from `credentials.json` emit a deprecation warning to stderr. No auto-migration — both files coexist until removal.

---

### Task 1: Create shared SSH key test fixtures

**Files:**

- Create: `test-fixtures/generate-ssh-vectors.mjs`
- Create: `test-fixtures/ssh-key-vectors.json`

**Step 1: Write a vector generator script**

A one-off Node.js script that:

1. Takes 3 known Ed25519 seeds (all zeros, sequential 0x01..0x20, all 0xFF)
2. Computes public keys via `@noble/ed25519`
3. Encodes as SSH public key format (`ssh-ed25519 AAAA...`)
4. Encodes as MoltNet format (`ed25519:<base64>`)
5. Writes `ssh-key-vectors.json`

Fixture format:

```json
{
  "vectors": [
    {
      "description": "zero seed",
      "seed_base64": "<base64>",
      "public_key_moltnet": "ed25519:<base64>",
      "public_key_ssh": "ssh-ed25519 <base64>"
    }
  ]
}
```

**Note:** Private key PEM is NOT in fixtures because Go's `gossh.MarshalPrivateKey` uses random check bytes — output differs per run. Tests validate public key exact match cross-platform. Private key tests verify structural validity (PEM headers, round-trip parse-and-sign).

**Step 2: Run the generator, verify output**

```bash
node test-fixtures/generate-ssh-vectors.mjs
cat test-fixtures/ssh-key-vectors.json
```

**Step 3: Commit**

```bash
git add test-fixtures/
git commit -m "test: add shared SSH key test vectors for cross-platform verification"
```

---

### Task 2: Add SSH key conversion to `@moltnet/crypto-service` (Node.js)

**Files:**

- Create: `libs/crypto-service/src/ssh.ts`
- Create: `libs/crypto-service/src/__tests__/ssh.test.ts`
- Modify: `libs/crypto-service/src/index.ts` (add exports)

**Step 1: Write failing tests**

`libs/crypto-service/src/__tests__/ssh.test.ts`:

- `toSSHPublicKey`: for each vector, assert exact match with `public_key_ssh`
- `toSSHPublicKey`: throws on invalid input (`'invalid'`, wrong length)
- `toSSHPrivateKey`: for each vector, assert PEM header/footer present
- `toSSHPrivateKey`: round-trip — sign with original seed via `cryptoService.sign()`, verify with `cryptoService.verify()` using the MoltNet public key (proves the key material is correct even if PEM bytes differ)
- `toSSHPrivateKey`: throws on invalid seed length

Load vectors from `../../../../test-fixtures/ssh-key-vectors.json`.

**Step 2: Run tests to verify they fail**

```bash
pnpm --filter @moltnet/crypto-service run test -- --run
```

Expected: FAIL — `toSSHPublicKey` and `toSSHPrivateKey` not found

**Step 3: Implement SSH key conversion**

`libs/crypto-service/src/ssh.ts`:

- `toSSHPublicKey(moltnetPublicKey: string): string`
  - Parse `ed25519:<base64>` → 32-byte pubkey
  - Build SSH wire format: `encodeSSHString("ssh-ed25519") + encodeSSHString(pubkeyBytes)`
  - Return `ssh-ed25519 <base64(blob)>`

- `toSSHPrivateKey(seedBase64: string): string`
  - Decode seed (32 bytes), derive pubkey via `ed.getPublicKey(seed)`
  - Build OpenSSH private key binary per [PROTOCOL.key](https://github.com/openssh/openssh-portable/blob/master/PROTOCOL.key):
    - AUTH_MAGIC (`openssh-key-v1\0`)
    - ciphername(`none`), kdfname(`none`), kdf(`""`), nkeys(1)
    - pubkey blob
    - private section: checkint×2, keytype, pubkey, privkey(seed+pub=64bytes), comment, padding
  - PEM encode with 70-char line wrap
  - Return full PEM string

- Helpers: `encodeSSHString(data: Buffer): Buffer`, `encodeUInt32(n: number): Buffer`

**Step 4: Export from index**

Add to `libs/crypto-service/src/index.ts`:

```typescript
export { toSSHPublicKey, toSSHPrivateKey } from './ssh.js';
```

**Step 5: Run tests to verify they pass**

```bash
pnpm --filter @moltnet/crypto-service run test -- --run
```

**Step 6: Commit**

```bash
git add libs/crypto-service/
git commit -m "feat(crypto-service): add Ed25519 to SSH key format conversion"
```

---

### Task 3: Add SSH key conversion to Go CLI

**Files:**

- Create: `cmd/moltnet/ssh.go`
- Create: `cmd/moltnet/ssh_test.go`
- Modify: `cmd/moltnet/main.go` (add `ssh-key` command + usage)
- Modify: `cmd/moltnet/go.mod` + `go.sum`

**Step 1: Add dependency**

```bash
cd cmd/moltnet && go get golang.org/x/crypto/ssh
```

**Step 2: Write failing tests**

`cmd/moltnet/ssh_test.go`:

- Load `../../test-fixtures/ssh-key-vectors.json` into a typed struct
- `TestToSSHPublicKey`: for each vector, assert exact match with `public_key_ssh`
- `TestToSSHPrivateKey`: for each vector, assert PEM parseable via `ssh.ParseRawPrivateKey`, assert PEM header/footer
- `TestToSSHPrivateKey_InvalidSeed`: assert error on short seed
- `TestRunSSHKeyExport`: integration test — write a temp `moltnet.json`, run `runSSHKeyExport`, verify files written with correct permissions

**Step 3: Run tests to verify they fail**

```bash
cd cmd/moltnet && go test -run TestToSSH -v
```

**Step 4: Implement**

`cmd/moltnet/ssh.go`:

- `ToSSHPublicKey(moltnetPublicKey string) (string, error)`
  - Use existing `ParsePublicKey()` from crypto.go
  - `gossh.NewPublicKey(ed25519.PublicKey(raw))` → `gossh.MarshalAuthorizedKey()` → trim newline

- `ToSSHPrivateKey(seedBase64 string) (string, error)`
  - Decode seed, `ed25519.NewKeyFromSeed(seed)`
  - `gossh.MarshalPrivateKey(priv, "")` → returns `*pem.Block`
  - `pem.EncodeToMemory(pemBlock)` → return string

- `runSSHKeyExport(args []string) error`
  - Flags: `--output-dir`, `--credentials`
  - Read credentials via `ReadConfig()`
  - Call both functions, write files
  - Private key: 0o600, public key: 0o644
  - Update `moltnet.json` with `ssh` section

**Step 5: Wire into main.go**

Add `case "ssh-key":` to switch, delegate to `runSSHKeyExport`. Update `printUsage()`.

**Step 6: Run tests to verify they pass**

```bash
cd cmd/moltnet && go test -run TestToSSH -v
```

**Step 7: Commit**

```bash
git add cmd/moltnet/
git commit -m "feat(cli): add ssh-key export command to Go CLI"
```

---

### Task 4: Evolve credentials.json to moltnet.json

**Files:**

- Modify: `libs/sdk/src/credentials.ts`
- Create: `libs/sdk/src/__tests__/credentials.test.ts`
- Modify: `libs/sdk/src/index.ts` (export new names)
- Modify: `cmd/moltnet/credentials.go`
- Modify: `cmd/moltnet/credentials_test.go`

**Deprecation rule:** `credentials.json` readable for 3 minor versions. Reads emit warning to stderr. New writes always go to `moltnet.json`. No auto-migration.

**Step 1: Write failing tests (Node.js)**

Use `tmp` dirs with test config files. Test cases:

- `readConfig()` reads `moltnet.json` when it exists
- `readConfig()` falls back to `credentials.json` when `moltnet.json` absent, emits deprecation warning
- `readConfig()` prefers `moltnet.json` when both exist
- `writeConfig()` always writes to `moltnet.json`
- New optional sections (`ssh`, `git`, `github`) round-trip correctly — write config with `ssh` section, read it back, verify section present
- `updateConfigSection('ssh', data)` merges into existing config
- `readCredentials()` still works as backwards-compat alias
- `getConfigPath()` returns path ending in `moltnet.json`

**Step 2: Run tests to verify they fail**

```bash
pnpm --filter @themoltnet/sdk run test -- --run
```

**Step 3: Implement (Node.js)**

Extend types:

```typescript
export interface MoltNetConfig {
  identity_id: string;
  registered_at: string;
  oauth2: { client_id: string; client_secret: string };
  keys: { public_key: string; private_key: string; fingerprint: string };
  endpoints: { api: string; mcp: string };
  ssh?: { private_key_path: string; public_key_path: string };
  git?: { name: string; email: string; signing: boolean; config_path: string };
  github?: {
    app_id: string;
    installation_id: string;
    private_key_path: string;
  };
}

/** @deprecated Use MoltNetConfig. Removal scheduled for 3 minor versions. */
export type CredentialsFile = MoltNetConfig;
```

New functions:

- `getConfigPath(configDir?: string): string` — returns `<configDir>/moltnet.json`
- `readConfig(path?: string): Promise<MoltNetConfig | null>` — try `moltnet.json` first, fall back to `credentials.json` with `console.warn` deprecation message
- `writeConfig(config: MoltNetConfig, path?: string): Promise<string>` — always writes `moltnet.json`, mode 0o600
- `updateConfigSection(section: keyof MoltNetConfig, data: object, configDir?: string): Promise<void>` — read, shallow merge section, write back

Deprecated aliases (keep existing exports working):

- `readCredentials` → delegates to `readConfig`
- `writeCredentials` → adapted to call `writeConfig`
- `getCredentialsPath` → returns `getConfigPath()` (points to new file)

**Step 4: Implement (Go)**

Add optional fields to struct:

```go
type MoltNetConfig struct {
    CredentialsFile          // embed existing fields
    SSH    *SSHConfig    `json:"ssh,omitempty"`
    Git    *GitConfig    `json:"git,omitempty"`
    GitHub *GitHubConfig `json:"github,omitempty"`
}
```

Or simpler: add fields directly to `CredentialsFile` with `omitempty`:

```go
type CredentialsFile struct {
    // ... existing fields ...
    SSH    *SSHSection    `json:"ssh,omitempty"`
    Git    *GitSection    `json:"git,omitempty"`
    GitHub *GitHubSection `json:"github,omitempty"`
}
```

- `GetConfigPath() (string, error)` → `moltnet.json`
- `ReadConfig() (*CredentialsFile, error)` — try `moltnet.json`, fall back with `fmt.Fprintf(os.Stderr, ...)` warning
- `WriteConfig(config *CredentialsFile) (string, error)` → `moltnet.json`
- Keep `ReadCredentials()` / `GetCredentialsPath()` as deprecated wrappers

Update existing code that calls `ReadCredentials` → `ReadConfig` internally.

**Step 5: Run tests**

```bash
pnpm --filter @themoltnet/sdk run test -- --run
cd cmd/moltnet && go test -run TestCredentials -v
cd cmd/moltnet && go test -run TestConfig -v
```

**Step 6: Commit**

```bash
git add libs/sdk/src/credentials.ts libs/sdk/src/__tests__/credentials.test.ts libs/sdk/src/index.ts cmd/moltnet/credentials.go cmd/moltnet/credentials_test.go
git commit -m "feat(sdk,cli): evolve credentials.json to moltnet.json (3 minor version compat)"
```

---

### Task 5: Add `exportSSHKey()` to SDK

**Files:**

- Create: `libs/sdk/src/ssh.ts`
- Create: `libs/sdk/src/__tests__/ssh.test.ts`
- Modify: `libs/sdk/src/index.ts` (export)

**Step 1: Write failing tests**

Use a temp dir with a test `moltnet.json`. Test cases:

- Reads config, writes `id_ed25519` and `id_ed25519.pub` to output dir
- Private key file has 0o600 permissions (check via `fs.stat`)
- Public key file has 0o644 permissions
- Updates `ssh` section in `moltnet.json` with paths
- Errors with clear message if no credentials found
- Custom `outputDir` works

**Step 2: Run tests to verify they fail**

```bash
pnpm --filter @themoltnet/sdk run test -- --run
```

**Step 3: Implement**

`libs/sdk/src/ssh.ts`:

```typescript
export async function exportSSHKey(opts?: {
  configPath?: string;
  outputDir?: string;
}): Promise<{ privatePath: string; publicPath: string }>;
```

1. `readConfig(opts?.configPath)` — error if null
2. `toSSHPrivateKey(config.keys.private_key)` from `@moltnet/crypto-service`
3. `toSSHPublicKey(config.keys.public_key)` from `@moltnet/crypto-service`
4. Write files to `opts?.outputDir ?? join(getConfigDir(), 'ssh')`
5. `updateConfigSection('ssh', { private_key_path, public_key_path })`
6. Return paths

**Step 4: Export from index**

```typescript
export { exportSSHKey } from './ssh.js';
```

**Step 5: Run tests, commit**

```bash
pnpm --filter @themoltnet/sdk run test -- --run
git add libs/sdk/src/ssh.ts libs/sdk/src/__tests__/ssh.test.ts libs/sdk/src/index.ts
git commit -m "feat(sdk): add exportSSHKey function"
```

---

### Task 6: Create `@moltnet/github-agent` package with git setup + credential helper

**Files:**

- Create: `packages/github-agent/package.json`
- Create: `packages/github-agent/tsconfig.json`
- Create: `packages/github-agent/src/index.ts`
- Create: `packages/github-agent/src/git-setup.ts`
- Create: `packages/github-agent/src/token.ts`
- Create: `packages/github-agent/src/credential-helper.ts`
- Create: `packages/github-agent/src/__tests__/git-setup.test.ts`
- Create: `packages/github-agent/src/__tests__/token.test.ts`
- Create: `packages/github-agent/src/__tests__/credential-helper.test.ts`
- Modify: `pnpm-workspace.yaml` (add `packages/*` glob if not present)

**Step 1: Check pnpm-workspace.yaml for `packages/*`**

If not present, add it.

**Step 2: Scaffold the package**

Follow CLAUDE.md "Adding a New Workspace":

- `package.json`: name `@moltnet/github-agent`, depends on `@moltnet/sdk` (workspace)
- `tsconfig.json`: extends root, `composite: true`, `outDir: ./dist`, `rootDir: ./src`
- Source-direct exports in `package.json`

**Step 3: Write failing tests for `setupGitIdentity`**

`git-setup.test.ts` — use temp dirs:

- Generates gitconfig with correct INI content (`[user]`, `[gpg]`, `[commit]`, `[tag]`, `[gpg "ssh"]`)
- Generates `allowed_signers` file with `<email> ssh-ed25519 AAAA...`
- Errors if SSH keys not exported yet (no `ssh` section in config)
- Updates `git` section in `moltnet.json`
- Custom `--name` / `--email` overrides work
- Default name/email come from config if available

**Step 4: Implement `setupGitIdentity`**

`packages/github-agent/src/git-setup.ts`:

```typescript
export async function setupGitIdentity(opts?: {
  name?: string;
  email?: string;
  configPath?: string;
}): Promise<string>; // returns path to gitconfig
```

1. Read `moltnet.json`, check `ssh` section exists
2. Read SSH public key file content
3. Build gitconfig INI string
4. Write `allowed_signers` file next to SSH keys
5. Write `gitconfig` to `~/.config/moltnet/gitconfig`
6. `updateConfigSection('git', { name, email, signing: true, config_path })`
7. Return gitconfig path

**Step 5: Write failing tests for `getInstallationToken`**

`token.test.ts`:

- Mock GitHub API (`POST /app/installations/{id}/access_tokens`)
- Test JWT creation from App RSA private key (verify JWT structure: iss, iat, exp)
- Test token extraction from mocked response
- Test error on missing `github` section in config
- Test error on invalid/missing App private key file

**Step 6: Implement `getInstallationToken`**

`packages/github-agent/src/token.ts`:

```typescript
export async function getInstallationToken(opts: {
  appId: string;
  privateKeyPath: string;
  installationId: string;
}): Promise<{ token: string; expiresAt: string }>;
```

1. Read RSA PEM from `privateKeyPath`
2. Create JWT: `{ iss: appId, iat: now-60, exp: now+600 }` signed with RS256 using Node.js `crypto.sign`
3. `POST https://api.github.com/app/installations/{installationId}/access_tokens` with `Authorization: Bearer <jwt>`
4. Return `{ token, expires_at }` from response

**Step 7: Write failing tests for `credentialHelper`**

`credential-helper.test.ts`:

- Test output format: `username=x-access-token\npassword=<token>\n` (git credential protocol)
- Mock `getInstallationToken` to return a known token

**Step 8: Implement `credentialHelper`**

`packages/github-agent/src/credential-helper.ts`:

```typescript
export async function credentialHelper(configPath?: string): Promise<void>;
```

1. Read `moltnet.json` github section
2. Call `getInstallationToken` with config values
3. Write to stdout: `username=x-access-token\npassword=<token>\n`

**Step 9: Wire exports**

`packages/github-agent/src/index.ts`:

```typescript
export { setupGitIdentity } from './git-setup.js';
export { getInstallationToken } from './token.js';
export { credentialHelper } from './credential-helper.js';
```

**Step 10: Run `pnpm install`, then tests**

```bash
pnpm install
pnpm --filter @moltnet/github-agent run test -- --run
```

**Step 11: Commit**

```bash
git add packages/github-agent/ pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat: add @moltnet/github-agent package (git setup, credential helper, GitHub App auth)"
```

---

### Task 7: Add `git setup` and `github credential-helper` to Go CLI

**Files:**

- Create: `cmd/moltnet/git.go`
- Create: `cmd/moltnet/git_test.go`
- Create: `cmd/moltnet/github.go`
- Create: `cmd/moltnet/github_test.go`
- Modify: `cmd/moltnet/main.go` (wire subcommands)

**Step 1: Write failing tests for `git setup`**

`cmd/moltnet/git_test.go`:

- `TestRunGitSetup`: write temp `moltnet.json` with `ssh` section, run `runGitSetup`, verify gitconfig + allowed_signers written, verify `git` section updated in config
- `TestRunGitSetup_NoSSH`: error when `ssh` section missing
- `TestRunGitSetup_CustomNameEmail`: custom overrides applied

**Step 2: Implement `git setup`**

`cmd/moltnet/git.go`:

- `runGitSetup(args []string) error` — flags: `--name`, `--email`, `--credentials`
- Same logic as Node.js `setupGitIdentity`: read config, build gitconfig INI, write files, update config

**Step 3: Write failing tests for `github credential-helper`**

`cmd/moltnet/github_test.go`:

- `TestCredentialHelper`: mock GitHub API, verify output format
- This can be a simpler implementation — the Go binary just needs to output git credential format

**Step 4: Implement `github credential-helper`**

`cmd/moltnet/github.go`:

- `runGitHubCredentialHelper(args []string) error`
- Read `moltnet.json` github section
- Create JWT, exchange for installation token (same logic as Node.js)
- Print `username=x-access-token\npassword=<token>\n` to stdout

**Step 5: Wire into main.go**

Add cases:

- `case "git":` → check `os.Args[2]` for `setup` subcommand
- `case "github":` → check `os.Args[2]` for `credential-helper` subcommand

Update `printUsage()`.

**Step 6: Run tests**

```bash
cd cmd/moltnet && go test ./... -v
```

**Step 7: Commit**

```bash
git add cmd/moltnet/
git commit -m "feat(cli): add git setup and github credential-helper to Go CLI"
```

---

### Task 8: Create `/accountable-commit` skill

**Files:**

- Create: `.claude/commands/accountable-commit.md`

**Step 1: Write the skill**

The `/accountable-commit` skill wraps the commit flow:

1. Run `git diff --cached --stat` to see staged changes
2. Classify by risk:
   - **High**: schema (`libs/database/`), auth (`libs/auth/`), crypto (`libs/crypto-service/`), CI (`.github/`), deps (`pnpm-lock.yaml`, `go.mod`)
   - **Medium**: new files, config changes, API routes
   - **Low**: test-only, docs, formatting
3. For high/medium: prompt agent to explain rationale, create diary entry via `diary_create` MCP tool
4. Include `MoltNet-Diary: <entry-id>` trailer in commit message
5. For low: commit normally

The skill should be self-contained markdown with clear instructions for the agent executing it.

**Step 2: Test manually**

Stage a change, run `/accountable-commit`, verify behavior.

**Step 3: Commit**

```bash
git add .claude/commands/accountable-commit.md
git commit -m "feat: add /accountable-commit skill for diary-linked commits"
```

---

### Task 9: Write the recipe and update docs

**Files:**

- Create: `docs/recipes/github-agent-setup.md`
- Modify: `docs/plans/2026-02-15-agent-git-identity-design.md` (update status)

**Step 1: Write the end-to-end recipe**

Sections:

1. **Prerequisites** — create GitHub App, download PEM, install on repos
2. **Agent registration** — `moltnet register --voucher <code>`
3. **SSH key export** — `moltnet ssh-key export`
4. **Git identity setup** — `moltnet git setup --name "moltnet-agent[bot]" --email "<app-noreply>"`
5. **GitHub agent config** — configure `moltnet.json` github section, or use `@moltnet/github-agent` programmatically
6. **Session activation** — `export GIT_CONFIG_GLOBAL=~/.config/moltnet/gitconfig`
7. **Verification** — test commit, `git log --show-signature`, test push
8. **Troubleshooting** — common issues and fixes

**Step 2: Update design doc status**

Change `Status: Approved` → `Status: Implemented`

**Step 3: Commit**

```bash
git add docs/
git commit -m "docs: add GitHub agent setup recipe"
```

---

### Task 10: Full validation and PR

**Step 1: Run full validation**

```bash
pnpm run validate          # lint + typecheck + test + build
cd cmd/moltnet && go test ./...
```

**Step 2: Fix any issues**

Address lint errors, type errors, failing tests.

**Step 3: Run full suite again to confirm clean**

```bash
pnpm run validate
cd cmd/moltnet && go test ./...
```

**Step 4: Create PR**

Create PR targeting `main` with summary of all changes, referencing issue #199 and the design doc.
