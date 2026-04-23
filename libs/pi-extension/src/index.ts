/**
 * @themoltnet/pi-extension — MoltNet pi extension
 *
 * Sandboxes tool execution in a Gondolin VM with:
 *   - Auto-built and cached VM snapshots
 *   - Credential injection (pi OAuth + MoltNet identity)
 *   - Egress policy (only LLM provider + MoltNet API)
 *   - Tool redirection (read/write/edit/bash → VM)
 *   - MoltNet custom tools (diary entries — run on host via SDK)
 *   - Optional git worktree per session
 *
 * Usage:
 *   pi -e @themoltnet/pi-extension
 *   pi -e @themoltnet/pi-extension --agent legreffier
 *   pi -e @themoltnet/pi-extension --worktree-branch feat/my-task
 *   pi -e @themoltnet/pi-extension --sandbox-config ./sandbox.json
 *
 * Sandbox config resolution (first match):
 *   1. --sandbox-config flag (explicit path to JSON)
 *   2. sandbox.json in cwd (convention)
 *   3. Base only (git, gh, moltnet CLI, agent user)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { VM } from '@earendil-works/gondolin';
import type {
  ExtensionAPI,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from '@mariozechner/pi-coding-agent';
import { connect } from '@themoltnet/sdk';

import type { ExtensionState, TrackedError } from './commands/index.js';
import {
  registerMoltnetReflectCommand,
  registerResolveIssueCommand,
  registerSandboxCommand,
} from './commands/index.js';
import { createMoltNetTools } from './moltnet/tools.js';
import { ensureSnapshot, type SandboxConfig } from './snapshot.js';
import {
  createGondolinBashOps,
  createGondolinEditOps,
  createGondolinReadOps,
  createGondolinWriteOps,
} from './tool-operations.js';
import { activateAgentEnv, findMainWorktree, resumeVm } from './vm-manager.js';

export {
  buildPiJudgeRecipeManifest,
  computePiJudgeRecipeCid,
  resolvePiJudgeRecipeVersions,
} from './moltnet/judge-recipe-cid.js';

const GUEST_WORKSPACE = '/workspace';

export default function moltnetExtension(pi: ExtensionAPI) {
  // -- Flags ------------------------------------------------------------------

  pi.registerFlag('agent', {
    description: 'MoltNet agent name (required — pass --agent <name>)',
    type: 'string',
    default: '',
  });

  pi.registerFlag('worktree-branch', {
    description:
      'Create a fresh git worktree for this session on the given branch',
    type: 'string',
    default: '',
  });

  pi.registerFlag('sandbox-config', {
    description: 'Path to sandbox config JSON (overrides sandbox.json in cwd)',
    type: 'string',
    default: '',
  });

  // -- Sandbox config resolution ------------------------------------------------

  function resolveSandboxConfig(): SandboxConfig | undefined {
    const flagPath = pi.getFlag('sandbox-config') as string;
    if (flagPath) {
      const abs = path.isAbsolute(flagPath)
        ? flagPath
        : path.join(process.cwd(), flagPath);
      return JSON.parse(readFileSync(abs, 'utf8'));
    }
    const conventionPath = path.join(process.cwd(), 'sandbox.json');
    if (existsSync(conventionPath)) {
      return JSON.parse(readFileSync(conventionPath, 'utf8'));
    }
    return undefined;
  }

  // -- State ------------------------------------------------------------------

  const localCwd = process.cwd();
  const localRead = createReadTool(localCwd);
  const localWrite = createWriteTool(localCwd);
  const localEdit = createEditTool(localCwd);
  const localBash = createBashTool(localCwd);

  let vm: VM | null = null;
  let vmStarting: Promise<VM> | null = null;
  let worktreePath: string | null = null;
  let moltnetAgent: Awaited<ReturnType<typeof connect>> | null = null;
  let diaryId: string | null = null;

  // -- VM bootstrap -----------------------------------------------------------

  async function ensureVm(ctx?: ExtensionContext): Promise<VM> {
    if (vm) return vm;
    if (vmStarting) return vmStarting;

    vmStarting = (async () => {
      const agentName = pi.getFlag('agent') as string;
      if (!agentName) {
        throw new Error(
          'Missing --agent flag. Usage: pi -e @themoltnet/pi-extension --agent <name>',
        );
      }
      const worktreeBranch = pi.getFlag('worktree-branch') as string;

      // 1. Ensure snapshot exists (auto-build on first run)
      ctx?.ui.setStatus(
        'sandbox',
        ctx.ui.theme.fg('accent', 'Sandbox: preparing...'),
      );

      const sandboxConfig = resolveSandboxConfig();
      const checkpointPath = await ensureSnapshot({
        config: sandboxConfig?.snapshot,
        onProgress: (msg) => {
          ctx?.ui.setStatus(
            'sandbox',
            ctx.ui.theme.fg('accent', `Sandbox: ${msg}`),
          );
        },
      });

      // 2. Create worktree if requested
      const mainRepo = findMainWorktree();
      let mountPath = localCwd;
      if (worktreeBranch) {
        const repoName = path.basename(mainRepo);
        const suffix = worktreeBranch.replace(/\//g, '-');
        worktreePath = path.resolve(mainRepo, '..', `${repoName}-${suffix}`);

        ctx?.ui.setStatus(
          'sandbox',
          ctx.ui.theme.fg('accent', `Sandbox: creating worktree ${suffix}...`),
        );

        if (!existsSync(worktreePath)) {
          execFileSync(
            'git',
            ['worktree', 'add', '-b', worktreeBranch, worktreePath],
            { cwd: mainRepo, stdio: 'pipe' },
          );
        }
        mountPath = worktreePath;
      }

      // 3. Repair any worktree pointers corrupted by prior VM sessions.
      // Before the VM started writing relative pointers, `git worktree add`
      // inside the sandbox persisted `/workspace/...` absolute paths that
      // are dead on the host. `git worktree repair --relative-paths`
      // rewrites both the `.git/worktrees/<name>/gitdir` file and each
      // worktree's `.git` file to relative form, which is valid from
      // both the host and the guest. No-op if nothing needs fixing.
      try {
        execFileSync(
          'git',
          ['-C', mainRepo, 'worktree', 'repair', '--relative-paths'],
          { stdio: 'pipe' },
        );
      } catch {
        // Best-effort — older git versions without --relative-paths will
        // fail here; the extension should not block the session on it.
      }

      // 4. Resume VM from snapshot
      ctx?.ui.setStatus(
        'sandbox',
        ctx.ui.theme.fg('accent', 'Sandbox: starting...'),
      );

      const managed = await resumeVm({
        checkpointPath,
        agentName,
        mountPath,
        sandboxConfig,
      });

      // 4. Activate agent env on the host (mirrors `moltnet start`)
      activateAgentEnv(managed.credentials.agentEnv, mainRepo);

      // 5. Connect to MoltNet on the host side (for custom tools)
      moltnetAgent = await connect({ configDir: managed.agentDir });
      diaryId = managed.credentials.agentEnv.MOLTNET_DIARY_ID ?? null;

      vm = managed.vm;

      const label = worktreePath
        ? `${mountPath} → ${GUEST_WORKSPACE}`
        : `${localCwd} → ${GUEST_WORKSPACE}`;
      ctx?.ui.setStatus(
        'sandbox',
        ctx.ui.theme.fg('accent', `Sandbox: running (${label})`),
      );
      ctx?.ui.notify(`Sandbox ready. Agent: ${agentName}`, 'info');

      return managed.vm;
    })();

    return vmStarting;
  }

  // -- Lifecycle hooks --------------------------------------------------------

  pi.on('session_start', async (_event, ctx) => {
    await ensureVm(ctx);
  });

  pi.on('session_shutdown', async (_event, ctx) => {
    if (!vm) return;
    ctx.ui.setStatus('sandbox', ctx.ui.theme.fg('muted', 'Sandbox: stopping'));
    try {
      await vm.close();
    } finally {
      vm = null;
      vmStarting = null;
      moltnetAgent = null;
    }
  });

  pi.on('before_agent_start', async (event, ctx) => {
    await ensureVm(ctx);
    const modified = event.systemPrompt.replace(
      `Current working directory: ${localCwd}`,
      `Current working directory: ${GUEST_WORKSPACE} (sandbox, mounted from host: ${worktreePath ?? localCwd})`,
    );
    return { systemPrompt: modified };
  });

  // -- Tool overrides (read/write/edit/bash → VM) ----------------------------

  pi.registerTool({
    ...localRead,
    async execute(id, params, signal, onUpdate, ctx) {
      const activeVm = await ensureVm(ctx);
      const tool = createReadTool(localCwd, {
        operations: createGondolinReadOps(activeVm, localCwd),
      });
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  pi.registerTool({
    ...localWrite,
    async execute(id, params, signal, onUpdate, ctx) {
      const activeVm = await ensureVm(ctx);
      const tool = createWriteTool(localCwd, {
        operations: createGondolinWriteOps(activeVm, localCwd),
      });
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  pi.registerTool({
    ...localEdit,
    async execute(id, params, signal, onUpdate, ctx) {
      const activeVm = await ensureVm(ctx);
      const tool = createEditTool(localCwd, {
        operations: createGondolinEditOps(activeVm, localCwd),
      });
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  pi.registerTool({
    ...localBash,
    label: 'bash (sandbox)',
    async execute(id, params, signal, onUpdate, ctx) {
      const activeVm = await ensureVm(ctx);
      const tool = createBashTool(localCwd, {
        operations: createGondolinBashOps(activeVm, localCwd),
      });
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  pi.on('user_bash', (_event, _ctx) => {
    if (!vm) return;
    return { operations: createGondolinBashOps(vm, localCwd) };
  });

  // -- MoltNet custom tools (run on host, not in VM) -------------------------

  const sessionErrors: TrackedError[] = [];

  const moltnetTools = createMoltNetTools({
    getAgent: () => moltnetAgent,
    getDiaryId: () => diaryId,
    getSessionErrors: () => sessionErrors,
    clearSessionErrors: () => {
      sessionErrors.length = 0;
    },
    getHostCwd: () => worktreePath ?? localCwd,
  });

  for (const tool of moltnetTools) {
    pi.registerTool(tool);
  }

  // -- Session learning (host-side error buffer, reviewable by the agent) ---

  const sessionStartTime = Date.now();

  function getAgentGhToken(): string | null {
    const gitConfigGlobal = process.env.GIT_CONFIG_GLOBAL;
    if (!gitConfigGlobal) return null;
    try {
      const credsDir = path.dirname(gitConfigGlobal);
      const credsPath = path.join(credsDir, 'moltnet.json');
      if (!existsSync(credsPath)) return null;
      return execFileSync(
        'npx',
        ['@themoltnet/cli', 'github', 'token', '--credentials', credsPath],
        {
          encoding: 'utf8',
          cwd: worktreePath ?? localCwd,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      ).trim();
    } catch {
      return null;
    }
  }

  let cachedGitBranch: string | null = null;

  async function getGitBranch(): Promise<string | null> {
    try {
      // When the sandbox is running, read branch from the guest workspace
      // (the agent may have created/switched branches inside the VM).
      if (vm) {
        const r = await vm.exec('git -C /workspace branch --show-current');
        if (r.exitCode === 0 && r.stdout?.trim()) {
          cachedGitBranch = r.stdout.trim();
          return cachedGitBranch;
        }
      }
      // Fallback: read from host worktree
      cachedGitBranch =
        execFileSync('git', ['branch', '--show-current'], {
          encoding: 'utf8',
          cwd: worktreePath ?? localCwd,
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim() || null;
      return cachedGitBranch;
    } catch {
      return cachedGitBranch;
    }
  }

  async function getSessionMeta(ctx: ExtensionContext) {
    const agentName = pi.getFlag('agent') as string;
    const gitBranch = await getGitBranch();
    const sessionName = ctx.sessionManager.getSessionName();
    const sessionId = ctx.sessionManager.getSessionId();
    const modelName = ctx.model?.name ?? ctx.model?.id ?? 'unknown';
    const durationMs = Date.now() - sessionStartTime;
    const durationMin = Math.round(durationMs / 60_000);

    return {
      agentName,
      gitBranch,
      sessionName,
      sessionId,
      modelName,
      cwd: ctx.cwd,
      worktree: worktreePath,
      durationMin,
    };
  }

  // Track tool errors with full context. The buffer is exposed to the agent
  // via the `moltnet_review_session_errors` tool and surfaced in
  // `/moltnet-reflect`, so the agent can decide whether anything is worth
  // persisting. We deliberately do not auto-write diary entries from raw
  // tool failures — most `isError: true` results are transient noise
  // (denied permission prompts, empty greps, typechecks mid-iteration) and
  // dumping them into the diary poisons retrieval.
  pi.on('tool_result', (event, _ctx) => {
    if (event.isError) {
      sessionErrors.push({
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        input: event.input,
        error:
          event.content
            ?.filter((c: { type: string; text?: string }) => c.type === 'text')
            .map((c: { type: string; text?: string }) => c.text)
            .join('\n')
            .slice(0, 500) ?? 'unknown error',
        timestamp: Date.now(),
      });
    }
  });

  // -- Commands ---------------------------------------------------------------

  const state: ExtensionState = {
    get vm() {
      return vm;
    },
    get worktreePath() {
      return worktreePath;
    },
    localCwd,
    get diaryId() {
      return diaryId;
    },
    get moltnetAgent() {
      return moltnetAgent;
    },
    sessionErrors,
    getSessionMeta,
    getAgentGhToken,
    ensureVm,
  };

  registerSandboxCommand(pi, state);
  registerResolveIssueCommand(pi, state);
  registerMoltnetReflectCommand(pi, state);
}

// Re-export modules for programmatic use
export { createMoltNetTools } from './moltnet/tools.js';
export type {
  EnsureSnapshotOptions,
  SandboxConfig,
  SnapshotConfig,
} from './snapshot.js';
export { ensureSnapshot } from './snapshot.js';
export {
  createGondolinBashOps,
  createGondolinEditOps,
  createGondolinReadOps,
  createGondolinWriteOps,
  toGuestPath,
} from './tool-operations.js';
export type { ManagedVm, VmConfig, VmCredentials } from './vm-manager.js';
export {
  activateAgentEnv,
  findMainWorktree,
  loadCredentials,
  resumeVm,
} from './vm-manager.js';

// Headless pi task executor. Previously exported under the `./runtime`
// subpath; collapsed to the root so the package has a single published
// entry and `check:pack` can bundle types cleanly via vite + rollupTypes.
export {
  createPiTaskExecutor,
  executePiTask,
  type ExecutePiTaskOptions,
} from './runtime/execute-pi-task.js';
