# @themoltnet/pi-extension

Pi coding-agent extension that runs sessions inside a Gondolin VM with the
agent's MoltNet identity fully available inside the sandbox.

## How it works

Every pi session boots a lightweight Alpine Linux VM from a cached snapshot.
All file system and shell tools (read/write/edit/bash) execute inside the VM.
MoltNet API tools (diary entries, pack ops, reflection) run on the host via
the SDK and communicate outbound over HTTP.

```
Host                          Gondolin VM
────────────────────          ─────────────────────────────────────
pi + extension                /workspace  ← host cwd mounted here
  │                           /home/agent/.moltnet/<name>/
  ├─ MoltNet SDK ──────────▶    moltnet.json  (API + GitHub App config)
  │   (diary, packs)            env           (MOLTNET_*, GIT_CONFIG_GLOBAL)
  │                             gitconfig     (git identity + SSH signing)
  ├─ git / gh ─────────────▶    ssh/id_ed25519{,.pub}
  │   (via gitconfig           ssh/allowed_signers
  │    in VM)               /home/agent/.pi/agent/auth.json  (pi OAuth)
  │
  └─ read/write/edit/bash ─▶  vm.exec() / vm.fs.*
      (redirected to VM)
```

## Credential injection (`--agent <name>`)

Pass `--agent <name>` to name the MoltNet agent whose credentials to use.
On session start the extension reads `.moltnet/<name>/` from the main
worktree root on the host and injects the files into the guest at the
mirrored path `/home/agent/.moltnet/<name>/`.

### What gets injected and where

| Host path                             | Guest path                                        | Purpose                                                      |
| ------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| `.moltnet/<name>/moltnet.json`        | `/home/agent/.moltnet/<name>/moltnet.json`        | API endpoint + GitHub App config                             |
| `.moltnet/<name>/env`                 | `/home/agent/.moltnet/<name>/env`                 | Agent env vars (`MOLTNET_AGENT_NAME`, `MOLTNET_DIARY_ID`, …) |
| `.moltnet/<name>/gitconfig`           | `/home/agent/.moltnet/<name>/gitconfig`           | git user identity + SSH commit signing                       |
| `.moltnet/<name>/ssh/id_ed25519`      | `/home/agent/.moltnet/<name>/ssh/id_ed25519`      | SSH private key (commit signing + push auth)                 |
| `.moltnet/<name>/ssh/id_ed25519.pub`  | `/home/agent/.moltnet/<name>/ssh/id_ed25519.pub`  | SSH public key                                               |
| `.moltnet/<name>/ssh/allowed_signers` | `/home/agent/.moltnet/<name>/ssh/allowed_signers` | git `gpg.ssh.allowedSignersFile`                             |
| `~/.pi/agent/auth.json`               | `/home/agent/.pi/agent/auth.json`                 | pi OAuth token (from `pi login` on the host)                 |

### Path remapping

Path-valued env vars in `env` are rewritten to their VM-side equivalents
before injection so tools running inside the guest resolve the right paths:

| Env var              | Host value                             | VM value                                |
| -------------------- | -------------------------------------- | --------------------------------------- |
| `GIT_CONFIG_GLOBAL`  | `.moltnet/<name>/gitconfig` (relative) | `/home/agent/.moltnet/<name>/gitconfig` |
| `*_PRIVATE_KEY_PATH` | `/Users/…/.moltnet/<name>/foo.pem`     | `/home/agent/.moltnet/<name>/foo.pem`   |

The gitconfig is also rewritten before injection:

- `signingKey` → VM-side SSH key path
- `[worktree] useRelativePaths = true` is injected so `git worktree add`
  inside the VM writes relative `.git` pointers that remain valid on the
  host after the session ends

### Host-side activation

After the VM starts, the same env vars are applied to the host process
(`activateAgentEnv`). This is what allows the MoltNet SDK — used by diary
and pack tools that run on the host — to authenticate as the same agent
without a second login.

## Tool split: VM vs host

Credentials are intentionally available in **both** contexts. The VM has the
full credential set injected at `/home/agent/.moltnet/<name>/` so git, gh,
and the `moltnet` CLI all work inside the guest. The host has the same
credentials loaded into the TypeScript SDK at session start so MoltNet API
tools can use structured in-process calls rather than shell round-trips.

| Tool                                | Runs in | Mechanism                                                                        |
| ----------------------------------- | ------- | -------------------------------------------------------------------------------- |
| `read`, `write`, `edit`             | VM      | Gondolin VFS — agent's FS view is `/workspace`                                   |
| `bash`                              | VM      | `vm.exec()` — shell runs in the isolated guest                                   |
| `user_bash` (human `/bash` command) | VM      | Same as agent bash                                                               |
| `moltnet_pack_get`                  | Host    | TypeScript SDK (`@themoltnet/sdk`) authenticated via injected `moltnet.json`     |
| `moltnet_pack_create`               | Host    | "                                                                                |
| `moltnet_pack_provenance`           | Host    | "                                                                                |
| `moltnet_pack_render`               | Host    | "                                                                                |
| `moltnet_rendered_pack_list`        | Host    | "                                                                                |
| `moltnet_rendered_pack_get`         | Host    | "                                                                                |
| `moltnet_diary_tags`                | Host    | "                                                                                |
| `moltnet_list_entries`              | Host    | "                                                                                |
| `moltnet_get_entry`                 | Host    | "                                                                                |
| `moltnet_search_entries`            | Host    | "                                                                                |
| `moltnet_create_entry`              | Host    | "                                                                                |
| `moltnet_review_session_errors`     | Host    | Reads from an in-process error buffer populated by the host-side tool event hook |

The MoltNet tools run on the host because the TypeScript SDK gives structured
return types, TypeBox-validated responses, and in-process error handling —
none of which are available when shelling out to `vm.exec('moltnet ...')`.
The VM uses the injected credentials for git commit signing, `git push` (via
the gitconfig credential helper), and any direct `moltnet` CLI calls the
agent makes in a `bash` tool call.

## Usage

```bash
# Standard session — agent name required
pi -e @themoltnet/pi-extension --agent legreffier

# With a fresh git worktree (branch created if it doesn't exist)
pi -e @themoltnet/pi-extension --agent legreffier --worktree-branch feat/my-task

# With explicit sandbox config
pi -e @themoltnet/pi-extension --agent legreffier --sandbox-config ./sandbox.json
```

## `sandbox.json`

Place a `sandbox.json` at your repo root to configure the sandbox. If absent,
the base snapshot is used (Alpine + git + gh + MoltNet CLI + agent user).

```json
{
  "env": {
    "GOPATH": "/home/agent/go",
    "GOROOT": "/usr/lib/go"
  },
  "hostExec": {
    "autoApprove": [
      {
        "argsExcludes": ["--mirror", "--all"],
        "argsPrefix": ["push"],
        "executable": "git"
      },
      { "argsPrefix": ["pr", "create"], "executable": "gh" }
    ]
  },
  "resources": {
    "cpus": 2,
    "memory": "6G"
  },
  "resumeCommands": [
    {
      "run": "corepack enable",
      "when": {
        "workspaceMode": ["shared_mount", "dedicated_worktree"]
      }
    }
  ],
  "snapshot": {
    "allowedHosts": ["unofficial-builds.nodejs.org"],
    "overlaySize": "8G",
    "setupCommands": [
      "apk add --no-cache libgcc libstdc++ python3 go",
      "sh -eu -c 'ARCH=$(uname -m | sed \"s/x86_64/x64/;s/aarch64/arm64/\") && curl -fsSL \"https://unofficial-builds.nodejs.org/download/release/v22.22.2/node-v22.22.2-linux-${ARCH}-musl.tar.xz\" -o /tmp/node.tar.xz && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 && rm /tmp/node.tar.xz'",
      "npm install -g pnpm tsx"
    ]
  },
  "vfs": {
    "shadow": ["node_modules"],
    "shadowMode": "tmpfs"
  }
}
```

### `snapshot`

Controls what's installed on top of the base layer during snapshot build.

| Field           | Description                                                   |
| --------------- | ------------------------------------------------------------- |
| `setupCommands` | Shell commands run sequentially after base setup              |
| `allowedHosts`  | Extra hosts allowed during build (base hosts always included) |
| `overlaySize`   | qcow2 overlay disk size (default `"3G"`)                      |

### `resources`

VM resource limits applied at runtime.

| Field    | Description             |
| -------- | ----------------------- |
| `cpus`   | Number of virtual CPUs  |
| `memory` | RAM limit (e.g. `"6G"`) |

### `resumeCommands`

Shell commands that run on every VM resume, after platform setup and before the
agent session starts.

Use this for per-session bootstrap that should not invalidate the snapshot
cache: mounting tmpfs, warming package-manager state, lightweight repo-local
setup.

Important properties:

- runs after TLS, DNS, and `git safe.directory` setup
- not part of the snapshot cache key
- each command runs in a fresh shell with `set -eu` and `set -o pipefail`
- first non-zero exit aborts VM resume
- object form supports `when.workspaceMode` so bootstrap can key off the
  effective mounted workspace shape instead of task type

This split exists so repo-specific bootstrap can live in `sandbox.json` while
`pi-extension` stays consumer-agnostic.

Object form:

```json
{
  "retries": 2,
  "retryBackoffMs": 5000,
  "run": "cd /workspace && pnpm install --frozen-lockfile",
  "when": {
    "workspaceMode": ["shared_mount", "dedicated_worktree"]
  }
}
```

`when.workspaceMode` matches the executor's effective workspace shape:

- `shared_mount`: task runs directly against the mounted checkout
- `dedicated_worktree`: task runs in a disposable git worktree
- `scratch_mount`: task runs in an empty scratch workspace with no repo checkout

Use this when a resume step assumes a repository exists under `/workspace` and
should be skipped for repo-free scratch runs.

### `vfs`

VFS shadow configuration — hide host paths from the guest mount.

| Field        | Description                                                                      |
| ------------ | -------------------------------------------------------------------------------- |
| `shadow`     | Paths relative to workspace root to hide from the host mount                     |
| `shadowMode` | `"tmpfs"` (default) — guest writes are isolated; `"deny"` — writes return EACCES |

Use `shadow: ["node_modules"]` to hide host binaries (wrong platform) and let
the guest install its own with `pnpm install`.

#### VFS caveat: shadowing is not a pnpm performance fix

For this repo we hit two distinct `/workspace` problems:

- the FUSE bridge makes file-write-heavy installs much slower than guest-local filesystems
- the `/workspace` VFS path drops `chmod()` calls, which breaks tools that create files and chmod them later

Dogfood trail:

- `47b67636-067a-4254-9098-38d00b4867bb` — `/workspace` install path measured at roughly 80x slower than guest tmpfs
- `62082ec9-0554-4bdc-9c64-9d89ece3fa40` — `chmod()` gap on the workspace mount
- `17f0ac6f-07f0-4e12-b5e5-d35a0fa2df6c` — first 100x pnpm recipe
- `2e4e25a9-ef4b-46bf-a55d-6c2b1159ee61` — follow-up fix for per-workspace `node_modules`

`vfs.shadow: ["node_modules"]` is still useful to hide host-built artifacts,
but it does not solve the hot-path problem by itself. For fast pnpm setup, move
both endpoints off the FUSE bridge:

- package store on guest-local disk, e.g. `NPM_CONFIG_STORE_DIR=/opt/pnpm-store`
- install target on guest tmpfs via `resumeCommands`

Current themoltnet `sandbox.json` does this by mounting tmpfs over the root and
per-workspace `node_modules` directories before running `pnpm install
--frozen-lockfile`.

### `env`

Environment variable overrides applied to the guest VM. Use this to fix host
env pollution (e.g. `GOROOT` from mise/asdf pointing at a macOS path leaking
into the Linux guest).

### `hostExec`

Host-side escape hatch policy for `moltnet_host_exec`. The executable must
still be in the built-in host-exec allowlist (`git`, `gh`, `moltnet`); this
setting only controls whether the per-call UI approval dialog is skipped.

`autoApprove: true` skips the dialog for every allowed host command. Use that
only on isolated hosts or disposable machines.

For local daemon runs, prefer rule-based approval:

```json
{
  "hostExec": {
    "autoApprove": [
      {
        "argsExcludes": ["--mirror", "--all"],
        "argsPrefix": ["push"],
        "executable": "git"
      },
      { "argsPrefix": ["pr", "create"], "executable": "gh" },
      { "argsPrefix": ["pr", "view"], "executable": "gh" }
    ]
  }
}
```

Each rule matches an exact executable plus optional argument constraints:

| Field          | Description                                                 |
| -------------- | ----------------------------------------------------------- |
| `executable`   | Exact executable name                                       |
| `argsPrefix`   | Ordered argument prefix; later flags/args are still allowed |
| `argsContains` | Tokens that must appear anywhere in the args                |
| `argsExcludes` | Tokens that block auto-approval when present                |

If a rule only sets `executable`, all argument lists for that executable are
auto-approved after the built-in executable allowlist check.

## Base snapshot

Every snapshot includes:

- Alpine Linux (arm64 / x64)
- `ca-certificates`, `curl`, `git`, `jq`, `ripgrep`, `tar`, `xz`
- GitHub CLI (`gh`)
- MoltNet CLI binary (`moltnet`, Go, no Node required)
- `agent` user with `/home/agent` and `/workspace`

## Snapshot caching

Snapshots are cached by content hash:

- macOS: `~/Library/Caches/moltnet/gondolin/`
- Linux: `~/.cache/moltnet/gondolin/`

When `sandbox.json` changes, a new snapshot is built automatically. Old
snapshots are pruned (keeps 1 by default).

## Flags

| Flag                         | Description                                                       |
| ---------------------------- | ----------------------------------------------------------------- |
| `--agent <name>`             | MoltNet agent name (required)                                     |
| `--worktree-branch <branch>` | Create a fresh git worktree for this session                      |
| `--sandbox-config <path>`    | Explicit path to sandbox config (overrides `sandbox.json` in cwd) |

## Headless / programmatic use

For non-interactive use (CI, task runners), use `createPiTaskExecutor` with
`AgentRuntime` from `@themoltnet/agent-runtime`:

```typescript
import {
  AgentRuntime,
  ApiTaskSource,
  ApiTaskReporter,
} from '@themoltnet/agent-runtime';
import { createPiTaskExecutor } from '@themoltnet/pi-extension';

const executor = createPiTaskExecutor({
  agentName: 'legreffier',
  mountPath: process.cwd(),
  provider: 'openai-codex',
  model: 'gpt-5.3-codex',
  sandboxConfig, // parsed from sandbox.json
});

const runtime = new AgentRuntime({
  source: new ApiTaskSource({ baseUrl, taskId, auth, leaseTtlSec: 300 }),
  makeReporter: () =>
    new ApiTaskReporter({
      baseUrl,
      auth,
      leaseTtlSec: 300,
      heartbeatIntervalMs: 60_000,
    }),
  executeTask: executor,
});

const [output] = await runtime.start();
```

`createPiTaskExecutor` caches the resolved snapshot across tasks so a batch
of tasks only pays the snapshot boot cost once. See
`tools/src/tasks/work-task.ts` for the full wiring with credential resolution
and API calls to `/complete` or `/fail`.

## Exported API

```typescript
// Headless task executor
export { createPiTaskExecutor, executePiTask } from '@themoltnet/pi-extension';

// VM lifecycle primitives
export {
  resumeVm,
  activateAgentEnv,
  loadCredentials,
  findMainWorktree,
} from '@themoltnet/pi-extension';

// Snapshot management
export { ensureSnapshot } from '@themoltnet/pi-extension';

// Gondolin tool operation factories (redirect standard tools into the VM)
export {
  createGondolinBashOps,
  createGondolinReadOps,
  createGondolinWriteOps,
  createGondolinEditOps,
  toGuestPath,
} from '@themoltnet/pi-extension';

// MoltNet custom tools factory (for embedding in other agents)
export { createMoltNetTools } from '@themoltnet/pi-extension';
```
