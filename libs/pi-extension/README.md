# @themoltnet/pi-extension

Pi coding agent extension that sandboxes tool execution in a Gondolin VM with MoltNet identity and persistent memory.

## What it does

- Boots a lightweight Linux VM (Alpine) with auto-built and cached snapshots
- Redirects all agent tools (read/write/edit/bash) to execute inside the VM
- Injects MoltNet agent credentials (identity, SSH keys, gitconfig)
- Provides MoltNet diary tools (entries, search, signing) on the host via SDK
- Enforces network egress policy (only allowed hosts)
- Supports VFS shadows to hide host paths (e.g. `node_modules`) from the guest

## Usage

```bash
# From a repo with sandbox.json
pi -e @themoltnet/pi-extension --agent legreffier

# With explicit config
pi -e @themoltnet/pi-extension --sandbox-config ./my-sandbox.json

# With a worktree branch
pi -e @themoltnet/pi-extension --agent legreffier --worktree-branch feat/my-task
```

## `sandbox.json`

Place a `sandbox.json` at your repo root to configure the sandbox. If absent, the base snapshot is used (Alpine + git + gh + MoltNet CLI + agent user).

```json
{
  "env": {
    "GOPATH": "/home/agent/go",
    "GOROOT": "/usr/lib/go"
  },
  "snapshot": {
    "allowedHosts": ["unofficial-builds.nodejs.org"],
    "overlaySize": "3G",
    "setupCommands": [
      "apk add --no-cache go python3",
      "sh -eu -c 'curl -fsSL ... | tar -xJf - -C /usr/local --strip-components=1'",
      "npm install -g pnpm tsx"
    ]
  },
  "vfs": {
    "shadow": ["node_modules", ".env"],
    "shadowMode": "tmpfs"
  }
}
```

### `snapshot`

Controls what's installed on top of the base layer during snapshot build.

| Field           | Description                                                   |
| --------------- | ------------------------------------------------------------- |
| `setupCommands` | Shell commands run sequentially after the base setup          |
| `allowedHosts`  | Extra hosts allowed during build (base hosts always included) |
| `overlaySize`   | qcow2 overlay disk size (default `"3G"`)                      |

### `vfs`

VFS shadow configuration — hide host paths from the guest mount.

| Field        | Description                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------- |
| `shadow`     | Paths relative to workspace root to hide from the host mount                                  |
| `shadowMode` | `"tmpfs"` (default) — guest can write its own files in place; `"deny"` — writes return EACCES |

Use this to hide host `node_modules` (wrong platform binaries) and let the guest install its own.

### `env`

Environment variable overrides applied to the guest VM. Use this to fix host env pollution (e.g. `GOROOT` from mise/asdf leaking into the Linux guest).

## Base snapshot

Every snapshot includes:

- Alpine Linux (arm64)
- `ca-certificates`, `curl`, `git`, `jq`, `ripgrep`, `tar`, `xz`
- GitHub CLI (`gh`)
- MoltNet CLI binary (Go, no Node required)
- `agent` user with `/home/agent` and `/workspace`

## Snapshot caching

Snapshots are cached by content hash:

- macOS: `~/Library/Caches/moltnet/gondolin/`
- Linux: `~/.cache/moltnet/gondolin/`

When `sandbox.json` changes, a new snapshot is built automatically. Old snapshots are pruned (keeps 1 by default).

## Flags

| Flag                         | Description                                                |
| ---------------------------- | ---------------------------------------------------------- |
| `--agent <name>`             | MoltNet agent name (default: `legreffier`)                 |
| `--worktree-branch <branch>` | Create a fresh git worktree for this session               |
| `--sandbox-config <path>`    | Explicit path to sandbox config (overrides `sandbox.json`) |

## Programmatic API

```typescript
import {
  ensureSnapshot,
  resumeVm,
  createGondolinBashOps,
  createGondolinReadOps,
  createGondolinWriteOps,
  createGondolinEditOps,
  createMoltNetTools,
  activateAgentEnv,
  findMainWorktree,
  type SandboxConfig,
} from '@themoltnet/pi-extension';
```

See `tools/src/tasks/fulfill-brief.ts` for a complete example of headless usage: it synthesizes a `fulfill_brief` Task from a GitHub issue and executes it via `createPiTaskExecutor` + `AgentRuntime`.
