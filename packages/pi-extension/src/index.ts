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
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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

import { createMoltNetTools } from './moltnet-tools.js';
import { ensureSnapshot } from './snapshot.js';
import {
  createGondolinBashOps,
  createGondolinEditOps,
  createGondolinReadOps,
  createGondolinWriteOps,
} from './tool-operations.js';
import { activateAgentEnv, findMainWorktree, resumeVm } from './vm-manager.js';

const GUEST_WORKSPACE = '/workspace';

export default function moltnetExtension(pi: ExtensionAPI) {
  // -- Flags ------------------------------------------------------------------

  pi.registerFlag('agent', {
    description: 'MoltNet agent name (default: legreffier)',
    type: 'string',
    default: 'legreffier',
  });

  pi.registerFlag('worktree-branch', {
    description:
      'Create a fresh git worktree for this session on the given branch',
    type: 'string',
    default: '',
  });

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
      const agentName = (pi.getFlag('agent') as string) || 'legreffier';
      const worktreeBranch = pi.getFlag('worktree-branch') as string;

      // 1. Ensure snapshot exists (auto-build on first run)
      ctx?.ui.setStatus(
        'sandbox',
        ctx.ui.theme.fg('accent', 'Sandbox: preparing...'),
      );

      const checkpointPath = await ensureSnapshot({
        onProgress: (msg) => {
          ctx?.ui.setStatus(
            'sandbox',
            ctx.ui.theme.fg('accent', `Sandbox: ${msg}`),
          );
        },
      });

      // 2. Create worktree if requested
      let mountPath = localCwd;
      if (worktreeBranch) {
        const mainRepo = findMainWorktree();
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

      // 3. Resume VM from snapshot
      ctx?.ui.setStatus(
        'sandbox',
        ctx.ui.theme.fg('accent', 'Sandbox: starting...'),
      );

      const managed = await resumeVm({
        checkpointPath,
        agentName,
        mountPath,
      });

      // 4. Activate agent env on the host (mirrors `moltnet start`)
      const mainRepo = findMainWorktree();
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
    // Record session errors before losing the MoltNet connection
    try {
      await createErrorEntry(ctx, 'session shutdown');
    } catch {
      // Best-effort — session is shutting down
    }

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

  const moltnetTools = createMoltNetTools({
    getAgent: () => moltnetAgent,
    getDiaryId: () => diaryId,
  });

  for (const tool of moltnetTools) {
    pi.registerTool(tool);
  }

  // -- Session learning (error tracking + automatic reflection) ---------------

  interface TrackedError {
    toolName: string;
    toolCallId: string;
    input: Record<string, unknown>;
    error: string;
    timestamp: number;
  }

  const sessionErrors: TrackedError[] = [];
  const sessionStartTime = Date.now();

  function getGitBranch(): string | null {
    try {
      return (
        execFileSync('git', ['branch', '--show-current'], {
          encoding: 'utf8',
          cwd: worktreePath ?? localCwd,
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim() || null
      );
    } catch {
      return null;
    }
  }

  function getSessionMeta(ctx: ExtensionContext) {
    const agentName = (pi.getFlag('agent') as string) || 'legreffier';
    const gitBranch = getGitBranch();
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

  function formatMetaBlock(meta: ReturnType<typeof getSessionMeta>): string {
    const lines = [
      `| Field | Value |`,
      `|-------|-------|`,
      `| Agent | ${meta.agentName} |`,
      `| Model | ${meta.modelName} |`,
      `| Branch | ${meta.gitBranch ?? 'detached/unknown'} |`,
      `| CWD | ${meta.cwd} |`,
    ];
    if (meta.worktree) lines.push(`| Worktree | ${meta.worktree} |`);
    if (meta.sessionName) lines.push(`| Session | ${meta.sessionName} |`);
    lines.push(`| Duration | ~${meta.durationMin} min |`);
    return lines.join('\n');
  }

  // Track tool errors with full context
  pi.on('tool_result', async (event, _ctx) => {
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

  async function createErrorEntry(
    ctx: ExtensionContext,
    trigger: string,
    extra?: string,
  ): Promise<void> {
    if (!moltnetAgent || !diaryId) return;
    if (sessionErrors.length === 0) return;

    const meta = getSessionMeta(ctx);
    const errorSummary = sessionErrors
      .map((e) => {
        const inputSnippet = JSON.stringify(e.input).slice(0, 100);
        return `- **${e.toolName}** (${new Date(e.timestamp).toISOString()})\n  Input: \`${inputSnippet}\`\n  Error: ${e.error.slice(0, 200)}`;
      })
      .join('\n');

    const branchTag = meta.gitBranch
      ? `branch:${meta.gitBranch.replace(/\//g, '-')}`
      : null;
    const tags = ['session-learning', 'errors', 'episodic'];
    if (branchTag) tags.push(branchTag);

    await moltnetAgent.entries.create(diaryId, {
      title: `Session incidents: ${sessionErrors.length} tool failure(s) on ${meta.gitBranch ?? 'unknown'}`,
      content: [
        `## Session incident log (${trigger})`,
        '',
        formatMetaBlock(meta),
        '',
        '### Errors encountered',
        '',
        errorSummary,
        ...(extra ? ['', extra] : []),
        '',
        '_Auto-generated by @themoltnet/pi-extension session learning._',
      ].join('\n'),
      tags,
      importance: sessionErrors.length >= 3 ? 7 : 4,
      entryType: 'episodic',
    });
  }

  // On session_tree (branch navigation) — record errors for the current branch
  pi.on('session_tree', async (event, ctx) => {
    try {
      await createErrorEntry(
        ctx,
        'tree navigation',
        `Branch navigated: \`${event.oldLeafId}\` → \`${event.newLeafId}\``,
      );
      sessionErrors.length = 0;
    } catch {
      // Don't let diary failures break the session
    }
  });

  // -- Commands ---------------------------------------------------------------

  pi.registerCommand('sandbox', {
    description: 'Show sandbox status and egress policy',
    handler: async (_args, ctx) => {
      if (!vm) {
        ctx.ui.notify('Sandbox is not running', 'warning');
        return;
      }
      const r = await vm.exec(
        'hostname && echo "---" && df -h / && echo "---" && node --version && pnpm --version && git --version',
      );
      ctx.ui.notify(
        [
          'Sandbox: running',
          `Workspace: ${worktreePath ?? localCwd} → ${GUEST_WORKSPACE}`,
          `MoltNet diary: ${diaryId ?? 'not configured'}`,
          r.stdout?.trimEnd() ?? '',
        ].join('\n'),
        'info',
      );
    },
  });

  pi.registerCommand('moltnet-reflect', {
    description:
      'Create a diary entry reflecting on the current session (decisions, findings, mistakes)',
    handler: async (_args, ctx) => {
      if (!moltnetAgent || !diaryId) {
        ctx.ui.notify('MoltNet not connected', 'error');
        return;
      }

      const meta = getSessionMeta(ctx);
      const errorCount = sessionErrors.length;

      pi.sendUserMessage(
        [
          'Review this session and create a MoltNet diary entry using the moltnet_create_entry tool.',
          '',
          '**Session context:**',
          `- Agent: ${meta.agentName}`,
          `- Model: ${meta.modelName}`,
          `- Branch: ${meta.gitBranch ?? 'unknown'}`,
          `- Duration: ~${meta.durationMin} min`,
          `- Tool errors this session: ${errorCount}`,
          meta.sessionName ? `- Session: ${meta.sessionName}` : '',
          '',
          'The entry should capture:',
          '- Key decisions made and their rationale',
          '- Findings or discoveries',
          '- Mistakes and what was learned',
          '- Any open questions or follow-ups needed',
          '',
          `Include tags: session-reflection${meta.gitBranch ? `, branch:${meta.gitBranch.replace(/\//g, '-')}` : ''}, and any relevant topic tags.`,
          'Set importance based on the significance of what was accomplished.',
        ]
          .filter(Boolean)
          .join('\n'),
        { deliverAs: 'followUp' },
      );
    },
  });
}

// Re-export modules for programmatic use
export { createMoltNetTools } from './moltnet-tools.js';
export type { EnsureSnapshotOptions, SnapshotRecipe } from './snapshot.js';
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
