# LeGreffier Init CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `packages/legreffier-cli` — a beautiful Ink (React for CLIs) app that runs `moltnet legreffier init`, orchestrating full one-command LeGreffier onboarding with Tron-styled branding.

**Architecture:** New standalone TypeScript package `packages/legreffier-cli` using Ink for the TUI. Calls `POST /public/legreffier/start`, polls status, exchanges GitHub App code client-side, exports SSH keys, writes all config files, downloads skills. Uses `@themoltnet/sdk` for crypto, credential management, and SSH export. Fully idempotent: each step checks its output artifact; a JSON state file at `~/.config/moltnet/legreffier-init.state.json` tracks workflow resumption.

**Tech Stack:** Ink 5, React 19, `@themoltnet/sdk`, `@moltnet/api-client`, `@moltnet/design-system` (tokens only), `@noble/ed25519`, `figlet` (slant font bundled), `open` (browser), TypeScript strict, Vite SSR build.

---

## Reference: Key APIs and Types

### Legreffier API endpoints (already in `@moltnet/api-client`)

```ts
// POST /public/legreffier/start — no auth
// Body: { publicKey, fingerprint, agentName }
// Response: { workflowId, manifestFormUrl }

// GET /public/legreffier/status/:workflowId — no auth
// Response: { status: 'awaiting_github' | 'github_code_ready' | 'awaiting_installation' | 'completed' | 'failed', githubCode?: string }
```

### GitHub App manifest code exchange (client-side, no auth)

```ts
// POST https://api.github.com/app-manifests/{code}/conversions
// Headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
// Response: { id, slug, name, pem, client_id, client_secret }
```

### Bot user lookup (public GitHub API)

```ts
// GET https://api.github.com/users/{slug}%5Bbot%5D
// Response: { id, login }
// Email: `${id}+${slug}[bot]@users.noreply.github.com`
```

### Skills location

```
raw.githubusercontent.com/getlarge/themoltnet/main/.claude/skills/legreffier/SKILL.md
raw.githubusercontent.com/getlarge/themoltnet/main/.claude/skills/accountable-commit/SKILL.md
```

Note: these paths match the existing skill location confirmed in `.claude/skills/`.

### State file schema

```ts
// ~/.config/moltnet/legreffier-init.state.json (mode 0o600)
// Deleted on successful completion
interface LegreffierInitState {
  workflowId: string;
  publicKey: string;
  fingerprint: string;
  agentName: string;
  phase: 'awaiting_github' | 'awaiting_installation' | 'post_github';
  // populated after code exchange:
  appId?: string;
  appSlug?: string;
  installationId?: string;
}
```

### Design system usage

The `@moltnet/design-system` package exports `colors` (and the full `tokens` object) from `tokens.ts` — pure JS with no DOM or React dependency. **All color values in the CLI must come from this import, not hardcoded hex strings.** This keeps the CLI visually consistent with the web app automatically.

```ts
import { colors } from '@moltnet/design-system';

// Use in Ink <Text color={...}>:
colors.primary.DEFAULT; // '#00d4c8' teal — network, step labels, active
colors.accent.DEFAULT; // '#e6a817' amber — identity values, fingerprints
colors.text.DEFAULT; // '#e8e8f0' — body text
colors.text.secondary; // '#555568' — secondary/muted
colors.success.DEFAULT; // '#40c060' — ✓ done
colors.error.DEFAULT; // '#f04060' — ✗ error
colors.border.DEFAULT; // '#252535' — dividers
```

The React components in `@moltnet/design-system` (Logo, Button, Card, etc.) are SVG/DOM-based and **cannot** render in a terminal. Instead, extend the design system with a new `cli/` subpath export containing Ink-native equivalents — same visual language, terminal-appropriate rendering.

**Design system extension: `libs/design-system/src/cli/`**

Add a new subpath `@moltnet/design-system/cli` exporting:

- `CliTheme` — the token subset relevant to terminal output (colors, spacing multipliers)
- `CliLogo` — figlet `slant` wordmark + the Molt mark rendered in Unicode/ANSI
- `CliStepHeader` — numbered step divider
- `CliStatusLine` — label + icon status line
- `CliSpinner` — animated braille spinner
- `CliDivider` — teal `═` separator

These are Ink React components that live in the design system (since they ARE the design system — same tokens, same visual identity, different render target). The `legreffier-cli` package imports them from `@moltnet/design-system/cli`.

---

## Task 1: Extend design system with `cli/` subpath

This task adds the Ink-native CLI components to `@moltnet/design-system` before scaffolding the CLI package. All visual identity lives here — the CLI package just imports and uses them.

**Files:**

- Create: `libs/design-system/src/cli/index.ts`
- Create: `libs/design-system/src/cli/theme.ts`
- Create: `libs/design-system/src/cli/CliLogo.tsx`
- Create: `libs/design-system/src/cli/CliStepHeader.tsx`
- Create: `libs/design-system/src/cli/CliStatusLine.tsx`
- Create: `libs/design-system/src/cli/CliSpinner.tsx`
- Create: `libs/design-system/src/cli/CliDivider.tsx`
- Modify: `libs/design-system/package.json` — add `./cli` subpath export + `ink` + `figlet` as optional peer deps
- Modify: `libs/design-system/src/index.ts` — do NOT re-export cli components from main entrypoint (keep DOM/CLI separate)

**Step 1: Add `ink` and `figlet` as peerDependencies to design system `package.json`**

Add to `libs/design-system/package.json`:

```json
"peerDependencies": {
  "ink": ">=5.0.0",
  "figlet": ">=1.0.0"
},
"peerDependenciesMeta": {
  "ink": { "optional": true },
  "figlet": { "optional": true }
},
"exports": {
  ".": { "import": "./src/index.ts", "types": "./src/index.ts" },
  "./cli": { "import": "./src/cli/index.ts", "types": "./src/cli/index.ts" }
}
```

**Step 2: Create `libs/design-system/src/cli/theme.ts`**

```ts
import { colors } from '../tokens.js';

/** Terminal-appropriate subset of MoltNet design tokens. */
export const cliTheme = {
  color: {
    primary: colors.primary.DEFAULT, // teal — network, active, borders
    accent: colors.accent.DEFAULT, // amber — identity values
    text: colors.text.DEFAULT, // body text
    muted: colors.text.secondary, // secondary/dim
    success: colors.success.DEFAULT, // ✓
    error: colors.error.DEFAULT, // ✗
    warning: colors.warning.DEFAULT, // ⚠
    border: colors.border.DEFAULT, // dividers
  },
} as const;
```

**Step 3: Create `libs/design-system/src/cli/CliLogo.tsx`**

The Molt mark in ASCII: a broken ring `◌` with inner diamond `◆`, rendered as Unicode chars followed by the figlet wordmark. The mark is hand-crafted Unicode — no SVG.

```tsx
import figlet from 'figlet';
import { Box, Text } from 'ink';
import React from 'react';
import { cliTheme } from './theme.js';

// Pre-render at module load time — figlet is sync
const WORDMARK = figlet.textSync('MOLTNET', { font: 'slant' });

export function CliLogo() {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box
        borderStyle="round"
        borderColor={cliTheme.color.primary}
        paddingX={2}
        flexDirection="column"
      >
        <Text> </Text>
        {WORDMARK.split('\n').map((line, i) => (
          <Text key={i} color={cliTheme.color.primary} bold>
            {line}
          </Text>
        ))}
        <Text> </Text>
        <Text color={cliTheme.color.text}>
          {'  '}Accountable AI commits. Cryptographic identity.
        </Text>
        <Text color={cliTheme.color.muted}>{'  '}themolt.net</Text>
        <Text> </Text>
      </Box>
    </Box>
  );
}
```

**Step 4: Create `libs/design-system/src/cli/CliStepHeader.tsx`**

```tsx
import { Box, Text } from 'ink';
import React from 'react';
import { cliTheme } from './theme.js';

export function CliStepHeader({
  n,
  total,
  label,
}: {
  n: number;
  total: number;
  label: string;
}) {
  const fill = '─'.repeat(Math.max(2, 48 - label.length));
  return (
    <Box marginTop={1}>
      <Text color={cliTheme.color.primary}>
        {`── ${n} / ${total}  ${label} ${fill}`}
      </Text>
    </Box>
  );
}
```

**Step 5: Create `libs/design-system/src/cli/CliStatusLine.tsx`**

```tsx
import { Text } from 'ink';
import React from 'react';
import { cliTheme } from './theme.js';

export type CliStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error';

const ICONS: Record<CliStatus, { icon: string; color: string }> = {
  pending: { icon: '·', color: cliTheme.color.muted },
  running: { icon: '…', color: cliTheme.color.primary },
  done: { icon: '✓', color: cliTheme.color.success },
  skipped: { icon: '↩', color: cliTheme.color.muted },
  error: { icon: '✗', color: cliTheme.color.error },
};

export function CliStatusLine({
  label,
  status,
  detail,
}: {
  label: string;
  status: CliStatus;
  detail?: string;
}) {
  const { icon, color } = ICONS[status];
  return (
    <Text>
      {'  '}
      <Text color={color}>{icon}</Text>
      {'  '}
      <Text color={cliTheme.color.text}>{label.padEnd(38)}</Text>
      {detail && <Text color={cliTheme.color.accent}>{detail}</Text>}
    </Text>
  );
}
```

**Step 6: Create `libs/design-system/src/cli/CliSpinner.tsx`**

```tsx
import { Text } from 'ink';
import React, { useEffect, useState } from 'react';
import { cliTheme } from './theme.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function CliSpinner({ label }: { label: string }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 80);
    return () => clearInterval(t);
  }, []);
  return (
    <Text>
      {'  '}
      <Text color={cliTheme.color.primary}>{FRAMES[frame]}</Text>
      {'  '}
      <Text color={cliTheme.color.text}>{label}</Text>
    </Text>
  );
}
```

**Step 7: Create `libs/design-system/src/cli/CliDivider.tsx`**

```tsx
import { Text } from 'ink';
import React from 'react';
import { cliTheme } from './theme.js';

export function CliDivider() {
  return (
    <Text color={cliTheme.color.primary}>
      {'  ══════════════════════════════════════════════════'}
    </Text>
  );
}
```

**Step 8: Create `libs/design-system/src/cli/index.ts`**

```ts
export { CliDivider } from './CliDivider.js';
export { CliLogo } from './CliLogo.js';
export { CliSpinner } from './CliSpinner.js';
export { type CliStatus, CliStatusLine } from './CliStatusLine.js';
export { CliStepHeader } from './CliStepHeader.js';
export { cliTheme } from './theme.js';
```

**Step 9: Run typecheck on design system**

```bash
pnpm --filter @moltnet/design-system typecheck
```

Expected: passes (ink types satisfied via peerDep, figlet types present).

**Step 10: Commit**

```bash
git add libs/design-system/src/cli/ libs/design-system/package.json
git commit -m "feat(design-system): add cli/ subpath — Ink components from shared tokens"
```

---

## Task 2: Scaffold `packages/legreffier-cli`

**Files:**

- Create: `packages/legreffier-cli/package.json`
- Create: `packages/legreffier-cli/tsconfig.json`
- Create: `packages/legreffier-cli/vite.config.ts`
- Create: `packages/legreffier-cli/src/index.tsx` (entry point)

**Step 1: Create `package.json`**

```json
{
  "name": "@themoltnet/legreffier",
  "version": "0.1.0",
  "description": "LeGreffier — one-command accountable AI agent setup",
  "license": "MIT",
  "type": "module",
  "repository": {
    "type": "git",
    "url": "https://github.com/getlarge/themoltnet.git",
    "directory": "packages/legreffier-cli"
  },
  "homepage": "https://themolt.net",
  "bin": {
    "legreffier": "dist/index.js"
  },
  "scripts": {
    "dev": "vite build --watch",
    "build": "vite build",
    "typecheck": "tsc -b --emitDeclarationOnly",
    "test": "vitest run --passWithNoTests",
    "lint": "eslint src/"
  },
  "files": ["dist"],
  "engines": { "node": ">=18" },
  "dependencies": {
    "@moltnet/api-client": "workspace:*",
    "@moltnet/design-system": "workspace:*",
    "@themoltnet/sdk": "workspace:*",
    "figlet": "^1.8.0",
    "ink": "^5.2.1",
    "open": "^10.1.2",
    "react": "catalog:"
  },
  "devDependencies": {
    "@types/figlet": "^1.7.0",
    "@types/node": "catalog:",
    "@types/react": "catalog:",
    "typescript": "catalog:",
    "vite": "catalog:",
    "vitest": "catalog:"
  }
}
```

**Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "jsx": "react-jsx",
    "lib": ["ES2022"]
  },
  "include": ["src"],
  "exclude": ["dist", "node_modules"]
}
```

**Step 3: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: true,
    target: 'node18',
    outDir: 'dist',
    rollupOptions: {
      input: 'src/index.tsx',
      output: {
        entryFileNames: 'index.js',
        format: 'esm',
      },
      external: [
        'node:fs',
        'node:fs/promises',
        'node:os',
        'node:path',
        'node:crypto',
        'node:child_process',
        'node:process',
        'node:readline',
        'node:stream',
        'node:tty',
        'node:events',
        'node:buffer',
        'node:url',
        'node:util',
        // ink deps that must remain external
        'ink',
        'react',
        'yoga-wasm-web',
      ],
    },
  },
});
```

**Step 4: Create stub `src/index.tsx`**

```tsx
#!/usr/bin/env node
import React from 'react';
import { render, Text } from 'ink';

function App() {
  return <Text color="#00d4c8">◈ MOLTNET — LeGreffier init (stub)</Text>;
}

render(<App />);
```

**Step 5: Install dependencies**

```bash
cd /path/to/themoltnet
pnpm install
```

Expected: workspace resolves, `ink`, `figlet`, `open` installed.

**Step 6: Verify build works**

```bash
pnpm --filter @themoltnet/legreffier build
```

Expected: `packages/legreffier-cli/dist/index.js` created, no errors.

**Step 7: Add to CI Go CLI check (not needed — this is TS, CI already covers it via lint/typecheck)**

**Step 8: Commit**

```bash
git add packages/legreffier-cli/
git commit -m "feat(legreffier-cli): scaffold Ink CLI package"
```

---

## Task 3 (was 2): Visual smoke test — render CLI components from design system

**Files:**

- Modify: `packages/legreffier-cli/src/index.tsx`

No new component files needed — all visual components come from `@moltnet/design-system/cli`.

**Step 1: Install dependencies**

```bash
pnpm install
```

**Step 2: Update `src/index.tsx` to render a visual smoke test**

```tsx
#!/usr/bin/env node
import React from 'react';
import { render, Box } from 'ink';
import {
  CliLogo,
  CliStepHeader,
  CliStatusLine,
  CliSpinner,
  CliDivider,
} from '@moltnet/design-system/cli';

function App() {
  return (
    <Box flexDirection="column">
      <CliLogo />
      <CliStepHeader n={1} total={4} label="Identity" />
      <CliStatusLine label="Generating Ed25519 keypair" status="done" />
      <CliStatusLine
        label="Registering on MoltNet"
        status="done"
        detail="A1B2-C3D4-E5F6-G7H8"
      />
      <CliStepHeader n={2} total={4} label="GitHub App" />
      <CliSpinner label="Waiting for app creation" />
      <CliDivider />
    </Box>
  );
}

render(<App />);
```

**Step 3: Build and run visually**

```bash
pnpm --filter @themoltnet/legreffier build
node packages/legreffier-cli/dist/index.js
```

Expected: figlet `slant` MOLTNET wordmark in teal inside a rounded border, step headers with `──` teal dividers, amber fingerprint value, braille spinner animates. Ctrl-C to exit.

**Step 4: Commit**

```bash
git add packages/legreffier-cli/src/index.tsx
git commit -m "feat(legreffier-cli): visual smoke test using design-system/cli components"
```

---

## Task 3: State file helpers + idempotency checks

**Files:**

- Create: `packages/legreffier-cli/src/state.ts`

This module manages `~/.config/moltnet/legreffier-init.state.json`.

```ts
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type InitPhase =
  | 'awaiting_github'
  | 'awaiting_installation'
  | 'post_github';

export interface LegreffierInitState {
  workflowId: string;
  publicKey: string;
  fingerprint: string;
  agentName: string;
  phase: InitPhase;
  appId?: string;
  appSlug?: string;
  installationId?: string;
}

function getStatePath(): string {
  return join(homedir(), '.config', 'moltnet', 'legreffier-init.state.json');
}

export async function readState(): Promise<LegreffierInitState | null> {
  try {
    const raw = await readFile(getStatePath(), 'utf-8');
    return JSON.parse(raw) as LegreffierInitState;
  } catch {
    return null;
  }
}

export async function writeState(state: LegreffierInitState): Promise<void> {
  const path = getStatePath();
  await mkdir(join(homedir(), '.config', 'moltnet'), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
}

export async function clearState(): Promise<void> {
  try {
    await rm(getStatePath());
  } catch {
    // already gone
  }
}
```

**Step 1: Create `src/state.ts`** as above.

**Step 2: Write tests `src/state.test.ts`**

```ts
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock homedir to use a temp dir
const tmpHome = join(
  tmpdir(),
  'moltnet-test-' + Math.random().toString(36).slice(2),
);

vi.mock('node:os', () => ({ homedir: () => tmpHome }));

// Re-import after mock
const { readState, writeState, clearState } = await import('./state.js');

describe('state helpers', () => {
  beforeEach(async () => {
    await mkdir(join(tmpHome, '.config', 'moltnet'), { recursive: true });
  });
  afterEach(async () => {
    await rm(tmpHome, { recursive: true, force: true });
  });

  it('returns null when no state file exists', async () => {
    expect(await readState()).toBeNull();
  });

  it('round-trips state', async () => {
    const state = {
      workflowId: 'wf-123',
      publicKey: 'ed25519:abc',
      fingerprint: 'A1B2-C3D4-E5F6-G7H8',
      agentName: 'my-bot',
      phase: 'awaiting_github' as const,
    };
    await writeState(state);
    expect(await readState()).toEqual(state);
  });

  it('clearState removes file', async () => {
    await writeState({
      workflowId: 'x',
      publicKey: 'x',
      fingerprint: 'x',
      agentName: 'x',
      phase: 'awaiting_github',
    });
    await clearState();
    expect(await readState()).toBeNull();
  });
});
```

**Step 3: Run tests**

```bash
pnpm --filter @themoltnet/legreffier test
```

Expected: 3 passing.

**Step 4: Commit**

```bash
git add packages/legreffier-cli/src/state.ts packages/legreffier-cli/src/state.test.ts
git commit -m "feat(legreffier-cli): state file helpers with tests"
```

---

## Task 4: GitHub helpers (code exchange + bot user lookup + git config)

**Files:**

- Create: `packages/legreffier-cli/src/github.ts`
- Create: `packages/legreffier-cli/src/github.test.ts`

```ts
// src/github.ts
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface GitHubAppCredentials {
  appId: string;
  appSlug: string;
  pem: string;
  clientId: string;
  clientSecret: string;
}

export interface BotUser {
  id: number;
  email: string;
}

/** Exchange a GitHub App manifest code for credentials. PEM never leaves the client. */
export async function exchangeManifestCode(
  code: string,
): Promise<GitHubAppCredentials> {
  const res = await fetch(
    `https://api.github.com/app-manifests/${code}/conversions`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub code exchange failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as {
    id: number;
    slug: string;
    pem: string;
    client_id: string;
    client_secret: string;
  };
  return {
    appId: String(data.id),
    appSlug: data.slug,
    pem: data.pem,
    clientId: data.client_id,
    clientSecret: data.client_secret,
  };
}

/** Look up GitHub bot user ID and derive noreply email. */
export async function lookupBotUser(appSlug: string): Promise<BotUser> {
  const res = await fetch(
    `https://api.github.com/users/${encodeURIComponent(appSlug + '[bot]')}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (!res.ok) {
    throw new Error(`GitHub user lookup failed (${res.status})`);
  }
  const data = (await res.json()) as { id: number; login: string };
  return {
    id: data.id,
    email: `${data.id}+${appSlug}[bot]@users.noreply.github.com`,
  };
}

/** Write GitHub App PEM to ~/.config/moltnet/github-app.pem (mode 0o600). */
export async function writePem(
  pem: string,
  configDir?: string,
): Promise<string> {
  const dir = configDir ?? join(homedir(), '.config', 'moltnet');
  await mkdir(dir, { recursive: true });
  const pemPath = join(dir, 'github-app.pem');
  await writeFile(pemPath, pem, { mode: 0o600 });
  await chmod(pemPath, 0o600);
  return pemPath;
}

/**
 * Write ~/.config/moltnet/gitconfig for GitHub App bot identity.
 * Signing key is the Ed25519 SSH key at sshKeyPath.
 */
export async function writeGitConfig(opts: {
  name: string;
  email: string;
  sshPrivKeyPath: string;
  allowedSignersPath: string;
  configDir?: string;
}): Promise<string> {
  const dir = opts.configDir ?? join(homedir(), '.config', 'moltnet');
  await mkdir(dir, { recursive: true });

  const gitconfigContent = `[user]
\tname = ${opts.name}
\temail = ${opts.email}
\tsigningkey = ${opts.sshPrivKeyPath}.pub

[gpg]
\tformat = ssh

[gpg "ssh"]
\tallowedSignersFile = ${opts.allowedSignersPath}

[commit]
\tgpgsign = true

[tag]
\tgpgsign = true
`;

  const gitconfigPath = join(dir, 'gitconfig');
  await writeFile(gitconfigPath, gitconfigContent, { mode: 0o644 });

  // Write allowed_signers
  const sshDir = join(dir, 'ssh');
  await mkdir(sshDir, { recursive: true });
  const pubKeyContent = (await import('node:fs/promises')).readFile(
    opts.sshPrivKeyPath + '.pub',
    'utf-8',
  );
  const allowedSigners = `${opts.email} ${(await pubKeyContent).trim()}\n`;
  await writeFile(opts.allowedSignersPath, allowedSigners, { mode: 0o644 });

  return gitconfigPath;
}
```

**Step 1: Create `src/github.ts`** as above.

**Step 2: Write tests for `writePem` and `writeGitConfig`** (mock filesystem, skip live GitHub API calls):

```ts
// src/github.test.ts
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { writePem } from './github.js';

const tmpDir = join(
  tmpdir(),
  'moltnet-github-test-' + Math.random().toString(36).slice(2),
);

describe('writePem', () => {
  beforeEach(() => mkdir(tmpDir, { recursive: true }));
  afterEach(() => rm(tmpDir, { recursive: true, force: true }));

  it('writes PEM with correct permissions', async () => {
    const pemPath = await writePem(
      '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----\n',
      tmpDir,
    );
    const content = await readFile(pemPath, 'utf-8');
    expect(content).toContain('BEGIN RSA PRIVATE KEY');
    expect(pemPath).toBe(join(tmpDir, 'github-app.pem'));
  });
});
```

**Step 3: Run tests**

```bash
pnpm --filter @themoltnet/legreffier test
```

Expected: passing.

**Step 4: Commit**

```bash
git add packages/legreffier-cli/src/github.ts packages/legreffier-cli/src/github.test.ts
git commit -m "feat(legreffier-cli): GitHub helpers — code exchange, bot lookup, PEM + gitconfig writers"
```

---

## Task 5: Skills downloader + settings.local.json writer

**Files:**

- Create: `packages/legreffier-cli/src/setup.ts`

```ts
// src/setup.ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SKILLS_BASE =
  'https://raw.githubusercontent.com/getlarge/themoltnet/main/.claude/skills';
const SKILLS = ['legreffier', 'accountable-commit'] as const;

/** Download skills from GitHub raw and write to .claude/skills/<name>/SKILL.md */
export async function downloadSkills(repoDir: string): Promise<string[]> {
  const written: string[] = [];
  for (const skill of SKILLS) {
    try {
      const url = `${SKILLS_BASE}/${skill}/SKILL.md`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const content = await res.text();
      const skillDir = join(repoDir, '.claude', 'skills', skill);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), content, { mode: 0o644 });
      written.push(skill);
    } catch (err) {
      // Non-fatal: warn, continue
      process.stderr.write(
        `Warning: failed to download skill ${skill}: ${err}\n`,
      );
    }
  }
  return written;
}

/**
 * Write (or merge) .claude/settings.local.json with the MoltNet env block.
 * Claude Code gitignores this file automatically.
 */
export async function writeSettingsLocal(opts: {
  repoDir: string;
  gitConfigGlobal: string;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const filePath = join(opts.repoDir, '.claude', 'settings.local.json');

  let existing: Record<string, unknown> = {};
  try {
    const raw = await readFile(filePath, 'utf-8');
    existing = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // file doesn't exist yet
  }

  const existingEnv =
    (existing.env as Record<string, string> | undefined) ?? {};
  const merged = {
    ...existing,
    env: {
      ...existingEnv,
      GIT_CONFIG_GLOBAL: opts.gitConfigGlobal,
      MOLTNET_CLIENT_ID: opts.clientId,
      MOLTNET_CLIENT_SECRET: opts.clientSecret,
    },
  };

  await mkdir(join(opts.repoDir, '.claude'), { recursive: true });
  await writeFile(filePath, JSON.stringify(merged, null, 2) + '\n', {
    mode: 0o600,
  });
  return filePath;
}
```

**Step 1: Create `src/setup.ts`** as above.

**Step 2: Write tests for `writeSettingsLocal`**

```ts
// src/setup.test.ts
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeSettingsLocal } from './setup.js';

const tmpDir = join(
  tmpdir(),
  'moltnet-setup-test-' + Math.random().toString(36).slice(2),
);

describe('writeSettingsLocal', () => {
  afterEach(() => rm(tmpDir, { recursive: true, force: true }));

  it('writes env block', async () => {
    await writeSettingsLocal({
      repoDir: tmpDir,
      gitConfigGlobal: '/home/user/.config/moltnet/gitconfig',
      clientId: 'cid',
      clientSecret: 'csec',
    });
    const raw = await readFile(
      join(tmpDir, '.claude', 'settings.local.json'),
      'utf-8',
    );
    const parsed = JSON.parse(raw);
    expect(parsed.env.GIT_CONFIG_GLOBAL).toBe(
      '/home/user/.config/moltnet/gitconfig',
    );
    expect(parsed.env.MOLTNET_CLIENT_ID).toBe('cid');
  });

  it('merges with existing settings', async () => {
    // pre-write a settings file with another key
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(join(tmpDir, '.claude'), { recursive: true });
    await writeFile(
      join(tmpDir, '.claude', 'settings.local.json'),
      JSON.stringify({ theme: 'dark', env: { EXISTING: 'yes' } }),
    );
    await writeSettingsLocal({
      repoDir: tmpDir,
      gitConfigGlobal: '/g',
      clientId: 'c',
      clientSecret: 's',
    });
    const parsed = JSON.parse(
      await readFile(join(tmpDir, '.claude', 'settings.local.json'), 'utf-8'),
    );
    expect(parsed.theme).toBe('dark');
    expect(parsed.env.EXISTING).toBe('yes');
    expect(parsed.env.GIT_CONFIG_GLOBAL).toBe('/g');
  });
});
```

**Step 3: Run tests**

```bash
pnpm --filter @themoltnet/legreffier test
```

Expected: passing.

**Step 4: Commit**

```bash
git add packages/legreffier-cli/src/setup.ts packages/legreffier-cli/src/setup.test.ts
git commit -m "feat(legreffier-cli): skills downloader + settings.local.json writer with tests"
```

---

## Task 6: MoltNet API helpers (start onboarding + poll status)

**Files:**

- Create: `packages/legreffier-cli/src/api.ts`

Uses the generated `@moltnet/api-client` functions.

```ts
// src/api.ts
import {
  createClient,
  getLegreffierOnboardingStatus,
  startLegreffierOnboarding,
} from '@moltnet/api-client';

const DEFAULT_API_URL = 'https://api.themolt.net';

export interface StartResult {
  workflowId: string;
  manifestFormUrl: string;
}

export async function startOnboarding(opts: {
  publicKey: string;
  fingerprint: string;
  agentName: string;
  apiUrl?: string;
}): Promise<StartResult> {
  const url = (opts.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, '');
  const client = createClient({ baseUrl: url });
  const result = await startLegreffierOnboarding({
    client,
    body: {
      publicKey: opts.publicKey,
      fingerprint: opts.fingerprint,
      agentName: opts.agentName,
    },
  });
  if (result.error) {
    throw new Error(`Start onboarding failed: ${JSON.stringify(result.error)}`);
  }
  return result.data!;
}

export type OnboardingStatus =
  | 'awaiting_github'
  | 'github_code_ready'
  | 'awaiting_installation'
  | 'completed'
  | 'failed';

export interface PollResult {
  status: OnboardingStatus;
  githubCode?: string;
}

export async function pollStatus(opts: {
  workflowId: string;
  apiUrl?: string;
}): Promise<PollResult> {
  const url = (opts.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, '');
  const client = createClient({ baseUrl: url });
  const result = await getLegreffierOnboardingStatus({
    client,
    path: { workflowId: opts.workflowId },
  });
  if (result.error) {
    throw new Error(`Poll status failed: ${JSON.stringify(result.error)}`);
  }
  return result.data! as PollResult;
}

/**
 * Poll until status matches one of the target statuses or timeout.
 * Calls onTick on each poll for UI updates.
 */
export async function pollUntil(opts: {
  workflowId: string;
  apiUrl?: string;
  targetStatuses: OnboardingStatus[];
  intervalMs?: number;
  timeoutMs?: number;
  onTick?: (status: OnboardingStatus) => void;
}): Promise<PollResult> {
  const interval = opts.intervalMs ?? 2000;
  const timeout = opts.timeoutMs ?? 620_000; // 10 min + buffer
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const result = await pollStatus({
      workflowId: opts.workflowId,
      apiUrl: opts.apiUrl,
    });
    opts.onTick?.(result.status);
    if (opts.targetStatuses.includes(result.status)) {
      return result;
    }
    if (result.status === 'failed') {
      throw new Error('Onboarding workflow failed on server');
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(
    'Polling timed out — the onboarding session may have expired. Run `legreffier init` to try again.',
  );
}
```

**Step 1: Create `src/api.ts`** as above.

**Step 2: Commit** (no unit tests needed — this is a thin wrapper over generated client, integration-only):

```bash
git add packages/legreffier-cli/src/api.ts
git commit -m "feat(legreffier-cli): MoltNet API helpers — start onboarding + poll status"
```

---

## Task 7: Main `InitApp` Ink component — full flow

**Files:**

- Create: `packages/legreffier-cli/src/InitApp.tsx`
- Modify: `packages/legreffier-cli/src/index.tsx`

This is the heart of the CLI. The component is a state machine driven by `useEffect` + `useState`. Each phase updates the UI declaratively.

```tsx
// src/InitApp.tsx
import { cryptoService } from '@moltnet/crypto-service';
import {
  exportSSHKey,
  getConfigDir,
  readConfig,
  writeConfig,
  writeMcpConfig,
  buildMcpConfig,
} from '@themoltnet/sdk';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import open from 'open';

import { pollUntil, startOnboarding } from './api.js';
import { Logo } from './components/Logo.js';
import { Spinner } from './components/Spinner.js';
import { StatusLine } from './components/StatusLine.js';
import { StepHeader } from './components/Step.js';
import {
  exchangeManifestCode,
  lookupBotUser,
  writePem,
  writeGitConfig,
} from './github.js';
import { downloadSkills, writeSettingsLocal } from './setup.js';
import { clearState, readState, writeState } from './state.js';

type Phase =
  | 'name_prompt'
  | 'identity'
  | 'github_app'
  | 'git_setup'
  | 'installation'
  | 'agent_setup'
  | 'done'
  | 'error';

interface StepStatus {
  keypair: 'pending' | 'running' | 'done' | 'skipped' | 'error';
  register: 'pending' | 'running' | 'done' | 'skipped' | 'error';
  githubApp: 'pending' | 'running' | 'done' | 'skipped' | 'error';
  gitSetup: 'pending' | 'running' | 'done' | 'skipped' | 'error';
  installation: 'pending' | 'running' | 'done' | 'skipped' | 'error';
  skills: 'pending' | 'running' | 'done' | 'skipped' | 'error';
  mcp: 'pending' | 'running' | 'done' | 'skipped' | 'error';
  settings: 'pending' | 'running' | 'done' | 'skipped' | 'error';
}

interface AppState {
  phase: Phase;
  agentName: string;
  errorMessage?: string;
  identityId?: string;
  fingerprint?: string;
  appSlug?: string;
  appId?: string;
  botEmail?: string;
  gitconfigPath?: string;
  repoDir: string;
  apiUrl: string;
  steps: StepStatus;
}

interface InitAppProps {
  name?: string;
  apiUrl?: string;
  dir?: string;
}

const DEFAULT_API_URL = 'https://api.themolt.net';

export function InitApp({
  name,
  apiUrl = DEFAULT_API_URL,
  dir = process.cwd(),
}: InitAppProps) {
  const { exit } = useApp();
  const [state, setState] = useState<AppState>({
    phase: name ? 'identity' : 'name_prompt',
    agentName: name ?? '',
    repoDir: dir,
    apiUrl,
    steps: {
      keypair: 'pending',
      register: 'pending',
      githubApp: 'pending',
      gitSetup: 'pending',
      installation: 'pending',
      skills: 'pending',
      mcp: 'pending',
      settings: 'pending',
    },
  });

  const updateStep = useCallback(
    (step: keyof StepStatus, status: StepStatus[keyof StepStatus]) => {
      setState((s) => ({ ...s, steps: { ...s.steps, [step]: status } }));
    },
    [],
  );

  const runInit = useCallback(
    async (agentName: string) => {
      setState((s) => ({ ...s, phase: 'identity', agentName }));
      const configDir = getConfigDir();

      try {
        // ── Phase 1: Identity ─────────────────────────────────
        let workflowId: string;
        let publicKey: string;
        let fingerprint: string;
        let clientId: string;
        let clientSecret: string;

        // Idempotency: check existing config
        const existingConfig = await readConfig(configDir);
        const existingState = await readState();

        if (existingConfig?.identity_id && existingConfig.oauth2.client_id) {
          // Already registered — skip keypair + register
          updateStep('keypair', 'skipped');
          updateStep('register', 'skipped');
          publicKey = existingConfig.keys.public_key;
          fingerprint = existingConfig.keys.fingerprint;
          clientId = existingConfig.oauth2.client_id;
          clientSecret = existingConfig.oauth2.client_secret;
          setState((s) => ({
            ...s,
            identityId: existingConfig.identity_id,
            fingerprint,
          }));

          // Check if we have a resumable workflow
          if (existingState && !existingConfig.github?.app_id) {
            workflowId = existingState.workflowId;
          } else if (!existingConfig.github?.app_id) {
            // Need to start a new onboarding workflow with existing key
            updateStep('register', 'skipped');
            const started = await startOnboarding({
              publicKey,
              fingerprint,
              agentName,
              apiUrl,
            });
            workflowId = started.workflowId;
            await writeState({
              workflowId,
              publicKey,
              fingerprint,
              agentName,
              phase: 'awaiting_github',
            });
          } else {
            workflowId = '';
          }
        } else {
          // Generate new keypair
          updateStep('keypair', 'running');
          const kp = await cryptoService.generateKeyPair();
          publicKey = kp.publicKey;
          fingerprint = kp.fingerprint;
          updateStep('keypair', 'done');

          // Start onboarding (issues voucher + registers agent server-side)
          updateStep('register', 'running');
          const started = await startOnboarding({
            publicKey,
            fingerprint,
            agentName,
            apiUrl,
          });
          workflowId = started.workflowId;

          // Save state immediately for resumption
          await writeState({
            workflowId,
            publicKey,
            fingerprint,
            agentName,
            phase: 'awaiting_github',
          });

          // Open browser to GitHub manifest form
          setState((s) => ({ ...s, phase: 'github_app' }));
          updateStep('githubApp', 'running');
          await open(started.manifestFormUrl);
        }

        // ── Phase 2: GitHub App ───────────────────────────────
        let appId: string;
        let appSlug: string;
        let pem: string;

        if (existingConfig?.github?.app_id) {
          // Already have GitHub App — skip
          updateStep('githubApp', 'skipped');
          appId = existingConfig.github.app_id;
          appSlug = existingConfig.github.app_slug ?? '';
          pem = ''; // PEM already written, no need to re-exchange
          clientId = existingConfig.oauth2.client_id;
          clientSecret = existingConfig.oauth2.client_secret;
          setState((s) => ({ ...s, appId, appSlug }));
        } else {
          setState((s) => ({ ...s, phase: 'github_app' }));
          updateStep('githubApp', 'running');

          // Poll until github_code_ready
          const pollResult = await pollUntil({
            workflowId,
            apiUrl,
            targetStatuses: [
              'github_code_ready',
              'awaiting_installation',
              'completed',
            ],
            intervalMs: 2000,
            timeoutMs: 620_000,
          });

          if (
            !pollResult.githubCode &&
            pollResult.status !== 'awaiting_installation' &&
            pollResult.status !== 'completed'
          ) {
            throw new Error('GitHub code not available in poll result');
          }

          if (pollResult.githubCode) {
            // Exchange code for credentials (client-side)
            const ghCreds = await exchangeManifestCode(pollResult.githubCode);
            appId = ghCreds.appId;
            appSlug = ghCreds.appSlug;
            pem = ghCreds.pem;
            clientId = ghCreds.clientId; // NOTE: these are GitHub App client_id/secret, not MoltNet
            clientSecret = ghCreds.clientSecret;

            // We need MoltNet creds from the workflow result — server registered the agent
            // After github_code_ready, the registration is complete — read from workflow via status
            // The server stores the registration in DBOS; creds are in the status response
            // Actually: registration happens BEFORE github callback — creds are in the start response
            // But /start doesn't return creds (server registers on behalf of keypair)
            // The creds (clientId/clientSecret) were returned during registerAgent server-side
            // We need them from a separate endpoint or the workflow result
            // DESIGN NOTE: See Task 8 for this — we add a /status response field for creds after completion

            await writePem(pem, configDir);
            await writeState({
              workflowId,
              publicKey,
              fingerprint,
              agentName,
              phase: 'awaiting_installation',
              appId,
              appSlug,
            });
          } else {
            // Already past code phase — read existing app info from state
            appId = existingState?.appId ?? '';
            appSlug = existingState?.appSlug ?? '';
            pem = '';
          }

          updateStep('githubApp', 'done');
          setState((s) => ({ ...s, appId, appSlug }));
        }

        // ── Phase 3: Git identity ─────────────────────────────
        setState((s) => ({ ...s, phase: 'git_setup' }));

        const existingSsh = await readConfig(configDir);
        if (
          existingSsh?.ssh?.private_key_path &&
          existingSsh?.git?.config_path
        ) {
          updateStep('gitSetup', 'skipped');
        } else {
          updateStep('gitSetup', 'running');
          const { privatePath } = await exportSSHKey({ configDir });
          const botUser = await lookupBotUser(appSlug);
          const allowedSignersPath = `${configDir}/ssh/allowed_signers`;
          const gitconfigPath = await writeGitConfig({
            name: agentName,
            email: botUser.email,
            sshPrivKeyPath: privatePath,
            allowedSignersPath,
            configDir,
          });
          setState((s) => ({ ...s, botEmail: botUser.email, gitconfigPath }));
          updateStep('gitSetup', 'done');
        }

        // ── Phase 4: Installation ─────────────────────────────
        setState((s) => ({ ...s, phase: 'installation' }));

        if (existingConfig?.github?.installation_id) {
          updateStep('installation', 'skipped');
        } else {
          updateStep('installation', 'running');
          // Open GitHub App installation page
          if (appSlug) {
            await open(`https://github.com/apps/${appSlug}/installations/new`);
          }
          // Poll until completed
          await pollUntil({
            workflowId,
            apiUrl,
            targetStatuses: ['completed'],
            intervalMs: 3000,
            timeoutMs: 3_660_000, // 1 hour + buffer
          });
          updateStep('installation', 'done');
        }

        // ── Phase 5: Agent setup ──────────────────────────────
        setState((s) => ({ ...s, phase: 'agent_setup' }));

        // Write .mcp.json
        updateStep('mcp', 'running');
        const mcpConfig = buildMcpConfig(apiUrl, { clientId, clientSecret });
        // Named after agent for clarity
        mcpConfig.mcpServers = {
          [agentName]: mcpConfig.mcpServers.moltnet,
        };
        await writeMcpConfig(mcpConfig, dir);
        updateStep('mcp', 'done');

        // Download + write skills
        updateStep('skills', 'running');
        await downloadSkills(dir);
        updateStep('skills', 'done');

        // Write settings.local.json
        updateStep('settings', 'running');
        const finalConfig = await readConfig(configDir);
        if (finalConfig?.git?.config_path) {
          await writeSettingsLocal({
            repoDir: dir,
            gitConfigGlobal: finalConfig.git.config_path,
            clientId,
            clientSecret,
          });
        }
        updateStep('settings', 'done');

        // Clear state file — setup complete
        await clearState();

        setState((s) => ({ ...s, phase: 'done' }));
        setTimeout(() => exit(), 500);
      } catch (err) {
        setState((s) => ({
          ...s,
          phase: 'error',
          errorMessage: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [apiUrl, dir, updateStep, exit],
  );

  // Kick off init when name is provided (or after prompt)
  useEffect(() => {
    if (state.phase === 'identity' && state.agentName) {
      runInit(state.agentName);
    }
  }, [state.phase, state.agentName, runInit]);

  // Handle name prompt submit
  const [nameInput, setNameInput] = useState('');
  const handleNameSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      runInit(trimmed);
    },
    [runInit],
  );

  return (
    <Box flexDirection="column" paddingX={1}>
      <Logo />

      {/* Name prompt */}
      {state.phase === 'name_prompt' && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="#e8e8f0">
            {' '}
            Agent name{' '}
            <Text color="#555568">(shown as {'<name>[bot]'} in git log)</Text>
          </Text>
          <Box>
            <Text color="#00d4c8"> ❯ </Text>
            <TextInput
              value={nameInput}
              onChange={setNameInput}
              onSubmit={handleNameSubmit}
            />
          </Box>
        </Box>
      )}

      {/* Step 1: Identity */}
      {state.phase !== 'name_prompt' && (
        <>
          <StepHeader n={1} total={4} label="Identity" />
          <StatusLine
            label="Generating Ed25519 keypair"
            status={state.steps.keypair}
          />
          <StatusLine
            label="Registering on MoltNet"
            status={state.steps.register}
            detail={state.fingerprint ? `  ${state.fingerprint}` : undefined}
          />
        </>
      )}

      {/* Step 2: GitHub App */}
      {[
        'github_app',
        'git_setup',
        'installation',
        'agent_setup',
        'done',
        'error',
      ].includes(state.phase) && (
        <>
          <StepHeader n={2} total={4} label="GitHub App" />
          {state.steps.githubApp === 'running' ? (
            <Spinner label="Waiting for GitHub App creation  (check your browser)" />
          ) : (
            <StatusLine
              label="GitHub App created"
              status={state.steps.githubApp}
              detail={state.appSlug ? `  ${state.appSlug}[bot]` : undefined}
            />
          )}
        </>
      )}

      {/* Step 3: Git identity */}
      {['git_setup', 'installation', 'agent_setup', 'done', 'error'].includes(
        state.phase,
      ) && (
        <>
          <StepHeader n={3} total={4} label="Git identity" />
          <StatusLine
            label="SSH key + gitconfig"
            status={state.steps.gitSetup}
            detail={
              state.gitconfigPath ? `  ${state.gitconfigPath}` : undefined
            }
          />
        </>
      )}

      {/* Step 4: Installation + setup */}
      {['installation', 'agent_setup', 'done', 'error'].includes(
        state.phase,
      ) && (
        <>
          <StepHeader n={4} total={4} label="Installation + setup" />
          {state.steps.installation === 'running' ? (
            <Spinner label="Waiting for GitHub App installation  (check your browser)" />
          ) : (
            <StatusLine
              label="GitHub App installed"
              status={state.steps.installation}
            />
          )}
          <StatusLine label=".mcp.json" status={state.steps.mcp} />
          <StatusLine
            label="Skills (.claude/skills/)"
            status={state.steps.skills}
          />
          <StatusLine
            label=".claude/settings.local.json"
            status={state.steps.settings}
          />
        </>
      )}

      {/* Done */}
      {state.phase === 'done' && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="#00d4c8">
            {'  ══════════════════════════════════════════════════'}
          </Text>
          <Text> </Text>
          <Text>
            <Text color="#00d4c8"> ◈ </Text>
            <Text color="#e8e8f0" bold>
              LeGreffier is ready.
            </Text>
          </Text>
          <Text> </Text>
          {state.botEmail && (
            <Text color="#e8e8f0">
              {'  '}Your next commit:{' '}
              <Text color="#e6a817">{state.agentName}[bot]</Text> ✓ Verified
            </Text>
          )}
          {state.botEmail && (
            <Text color="#555568">
              {'  '}Email: {state.botEmail}
            </Text>
          )}
          <Text> </Text>
          <Text color="#e8e8f0">
            {'  '}Run <Text color="#00d4c8">/legreffier</Text> in Claude Code to
            activate.
          </Text>
          <Text color="#555568">{'  '}Docs → themolt.net</Text>
          <Text> </Text>
          <Text color="#00d4c8">
            {'  ══════════════════════════════════════════════════'}
          </Text>
        </Box>
      )}

      {/* Error */}
      {state.phase === 'error' && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="#f04060">
            {'  ✗  '}Error: {state.errorMessage}
          </Text>
          <Text color="#555568">
            {'  '}Run <Text color="#e8e8f0">legreffier init</Text> to retry —
            previous progress is saved.
          </Text>
        </Box>
      )}
    </Box>
  );
}
```

**Step 1: Install `ink-text-input`** — add to `package.json` dependencies: `"ink-text-input": "^5.0.1"`, then `pnpm install`.

**Step 2: Create `src/InitApp.tsx`** as above.

**Step 3: Update `src/index.tsx`** to parse args and render `InitApp`:

```tsx
#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { InitApp } from './InitApp.js';

const args = process.argv.slice(2);
const nameIdx = args.indexOf('--name');
const name = nameIdx >= 0 ? args[nameIdx + 1] : undefined;
const apiUrlIdx = args.indexOf('--api-url');
const apiUrl = apiUrlIdx >= 0 ? args[apiUrlIdx + 1] : undefined;
const dirIdx = args.indexOf('--dir');
const dir = dirIdx >= 0 ? args[dirIdx + 1] : undefined;

render(<InitApp name={name} apiUrl={apiUrl} dir={dir} />);
```

**Step 4: Build**

```bash
pnpm --filter @themoltnet/legreffier build
```

Expected: builds without type errors.

**Step 5: Commit**

```bash
git add packages/legreffier-cli/src/InitApp.tsx packages/legreffier-cli/src/index.tsx
git commit -m "feat(legreffier-cli): main InitApp component — full 4-step onboarding flow"
```

---

## Task 8: Resolve MoltNet credential retrieval post-registration

**Context:** The legreffier workflow registers the agent server-side (steps 1+2 happen in DBOS before the GitHub callback). The `POST /public/legreffier/start` response only returns `workflowId + manifestFormUrl` — not `clientId/clientSecret`. These are needed to write `.mcp.json` and `settings.local.json`.

**Solution:** The workflow result (accessible via `DBOS.getWorkflowResult`) contains `clientId` and `clientSecret` from `RegistrationResult`. Expose them in the `GET /public/legreffier/status/:workflowId` response when status is `completed`.

**Files to modify:**

- `libs/models/src/schemas.ts` — add `clientId`, `clientSecret` to `OnboardingStatusResponseSchema` completed variant
- `apps/rest-api/src/routes/public.ts` — return creds in the `completed` status response
- `apps/rest-api/src/workflows/legreffier-onboarding-workflow.ts` — verify `OnboardingResult` includes creds (it extends `RegistrationResult` which has them)

**Step 1: Check `RegistrationResult` type**

```bash
grep -n "RegistrationResult\|clientId\|clientSecret" apps/rest-api/src/workflows/registration-workflow.ts | head -20
```

Expected: `RegistrationResult` includes `clientId` and `clientSecret`.

**Step 2: Update `OnboardingStatusResponseSchema` in `libs/models/src/schemas.ts`**

Find the `OnboardingStatusResponseSchema` and add a `completed` variant with credentials:

```ts
// In the discriminated union, add to the 'completed' branch:
Type.Object({
  status: Type.Literal('completed'),
  clientId: Type.Optional(Type.String()),
  clientSecret: Type.Optional(Type.String()),
}),
```

**Step 3: Update the status route in `apps/rest-api/src/routes/public.ts`**

In the `status === 'SUCCESS'` branch, retrieve the workflow result and include creds:

```ts
if (wfStatus.status === 'SUCCESS') {
  try {
    const result = (await handle.getResult()) as OnboardingResult;
    return {
      status: 'completed' as const,
      clientId: result.clientId,
      clientSecret: result.clientSecret,
    };
  } catch {
    return { status: 'completed' as const };
  }
}
```

**Step 4: Run typecheck + tests**

```bash
pnpm run typecheck
pnpm run test
```

Expected: all passing.

**Step 5: Update `src/api.ts` in legreffier-cli** to capture creds from completed status:

```ts
// In PollResult interface, add:
clientId?: string;
clientSecret?: string;
```

**Step 6: Update `InitApp.tsx`** to read `clientId`/`clientSecret` from the completed poll result instead of from GitHub App exchange.

**Step 7: Commit**

```bash
git add libs/models/src/schemas.ts apps/rest-api/src/routes/public.ts packages/legreffier-cli/src/api.ts packages/legreffier-cli/src/InitApp.tsx
git commit -m "feat(legreffier): expose MoltNet creds in onboarding status on completion"
```

---

## Task 9: Add `legreffier` command to Go CLI main.go + update README

**Files:**

- Modify: `cmd/moltnet/main.go` — add `legreffier` command pointing to the npm package
- Modify: `cmd/moltnet/README.md`
- Modify: `packages/legreffier-cli/README.md` (create)

**Step 1: Add legreffier subcommand to `main.go`**

In the `switch os.Args[1]` block, add:

```go
case "legreffier":
    if len(os.Args) < 3 || os.Args[2] != "init" {
        fmt.Fprintln(os.Stderr, "Usage: moltnet legreffier init [--name <name>]")
        fmt.Fprintln(os.Stderr, "  Or run directly: npx @themoltnet/legreffier")
        os.Exit(1)
    }
    fmt.Fprintln(os.Stderr, "Run: npx @themoltnet/legreffier --name <name>")
    fmt.Fprintln(os.Stderr, "Or install: npm i -g @themoltnet/legreffier && legreffier")
    os.Exit(0)
```

And in `printUsage()`:

```go
fmt.Fprintln(os.Stderr, "  legreffier   One-command LeGreffier setup (npx @themoltnet/legreffier)")
```

**Step 2: Create `packages/legreffier-cli/README.md`**

````markdown
# @themoltnet/legreffier

One-command LeGreffier setup — accountable AI agent commits with cryptographic identity.

## Usage

```bash
npx @themoltnet/legreffier
# or
npm i -g @themoltnet/legreffier
legreffier --name my-bot
```
````

## What it does

1. Generates an Ed25519 keypair and registers on MoltNet
2. Creates a GitHub App via the manifest flow (browser opens automatically)
3. Configures git identity for SSH commit signing
4. Installs LeGreffier skills in your Claude Code project

## Links

- [themolt.net](https://themolt.net)
- [Issue #287](https://github.com/getlarge/themoltnet/issues/287)

````

**Step 3: Commit**

```bash
git add cmd/moltnet/main.go packages/legreffier-cli/README.md cmd/moltnet/README.md
git commit -m "feat(legreffier-cli): wire legreffier command in Go CLI + READMEs"
````

---

## Task 10: CI integration + release-please config

**Files:**

- Modify: `.github/workflows/ci.yml` — ensure `@themoltnet/legreffier` is built + tested
- Modify: `release-please-config.json`
- Modify: `.release-please-manifest.json`

**Step 1: Verify CI already covers it**

The monorepo CI runs `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build` — all recursive across workspaces. New package is automatically included. Verify:

```bash
pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build
```

Expected: all passing, `packages/legreffier-cli/dist/index.js` built.

**Step 2: Add to release-please config**

In `release-please-config.json`, add:

```json
"packages/legreffier-cli": {
  "release-type": "node",
  "package-name": "@themoltnet/legreffier"
}
```

In `.release-please-manifest.json`, add:

```json
"packages/legreffier-cli": "0.1.0"
```

**Step 3: Add publish job to `.github/workflows/release.yml`**

Copy pattern from existing `publish-sdk` job, adjust package filter to `@themoltnet/legreffier`.

**Step 4: Commit**

```bash
git add release-please-config.json .release-please-manifest.json .github/workflows/release.yml
git commit -m "chore: add @themoltnet/legreffier to release-please + CI publish"
```

---

## Task 11: Write journal entry + open PR

**Step 1: Write journal entry**

```bash
# Run /handoff skill to write journal entry
```

Or manually create `docs/journal/2026-02-24-05-legreffier-init-cli.md`.

**Step 2: Update `docs/journal/README.md` index**

**Step 3: Final validation**

```bash
pnpm run validate   # lint + typecheck + test + build
```

Expected: all green.

**Step 4: Push + open PR**

```bash
git push origin HEAD
gh pr create \
  --title "feat(legreffier-cli): moltnet legreffier init — Ink CLI for one-command onboarding" \
  --body "..."
```

---

## Key Design Notes for Implementer

1. **`@moltnet/api-client` is already generated** and contains `startLegreffierOnboarding` + `getLegreffierOnboardingStatus`. Use them directly — don't hand-write fetch calls for these.

2. **`@themoltnet/sdk` exports everything needed**: `cryptoService.generateKeyPair()`, `exportSSHKey()`, `readConfig()`, `writeConfig()`, `writeMcpConfig()`, `buildMcpConfig()`. Use them — don't reinvent.

3. **`@noble/ed25519` is in the catalog** and used by `@moltnet/crypto-service`. The SDK's `cryptoService` is the right abstraction to use.

4. **Idempotency is per-artifact**: each step checks whether its output already exists before running. The state file tracks in-flight workflow IDs only.

5. **Task 8 (credential retrieval) is the only server-side change** needed. All other tasks are pure client-side.

6. **All colors come from `@moltnet/design-system`** via `import { colors } from '@moltnet/design-system'` or the `cliTheme` re-export from `@moltnet/design-system/cli`. Never hardcode hex strings in the CLI package — if the brand changes, it changes everywhere.

7. **All Ink UI components live in `libs/design-system/src/cli/`** — not in `packages/legreffier-cli`. The CLI package only imports them. This keeps the visual identity centralized and reusable for any future CLI tool.

8. **Ink `<Box borderStyle="round">` renders the border** as a single box-drawing character border — this is how the logo gets its branded frame cleanly.

9. **`figlet` fonts are JS** — `slant` is bundled at build time as a peer dep of the design system, no native binary required.

10. **`open`** works on macOS/Linux/Windows, uses the system default browser.
