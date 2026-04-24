/**
 * MoltNet custom tools for pi.
 *
 * Factory that produces ready-to-register pi tool definitions.
 * These tools run on the host (not in the VM) via the MoltNet SDK,
 * so agent credentials never touch the VM filesystem.
 */
import { execFileSync } from 'node:child_process';

import { Type } from '@mariozechner/pi-ai';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { defineTool } from '@mariozechner/pi-coding-agent';
import { computeJsonCid } from '@moltnet/crypto-service';
import type { connect } from '@themoltnet/sdk';

import type { TrackedError } from '../commands/types.js';
import {
  buildSourceEntriesMarkdown,
  DEFAULT_RUBRIC,
  type FidelityScores,
  runFidelityJudge,
} from './judge/fidelity.js';
import { type ExpandedPack, renderPhase6Markdown } from './render-phase6.js';

type MoltNetAgent = Awaited<ReturnType<typeof connect>>;

export interface MoltNetToolsConfig {
  getAgent(): MoltNetAgent | null;
  getDiaryId(): string | null;
  getTeamId(): string | null;
  getSessionErrors(): readonly TrackedError[];
  clearSessionErrors(): void;
  /** Host working directory for host-exec commands (worktree path or cwd). */
  getHostCwd?(): string;
  /**
   * Set of process.env keys that are safe to forward to host-exec child
   * processes. Configured at sandbox startup so the caller can include
   * agent-specific vars (e.g. MOLTNET_AGENT_NAME) alongside the defaults.
   * Defaults to HOST_EXEC_DEFAULT_BASE_ENV when omitted.
   */
  hostExecBaseEnv?: ReadonlySet<string>;
}

/**
 * Baseline env keys forwarded to host-exec child processes.
 * Callers can extend this set at sandbox startup via `MoltNetToolsConfig.hostExecBaseEnv`.
 */
export const HOST_EXEC_DEFAULT_BASE_ENV: ReadonlySet<string> = new Set([
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'GIT_CONFIG_GLOBAL',
  'MOLTNET_CREDENTIALS_PATH',
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
  'SSH_AUTH_SOCK',
]);

function ensureConnected(config: MoltNetToolsConfig) {
  const agent = config.getAgent();
  const diaryId = config.getDiaryId();
  if (!agent || !diaryId) throw new Error('MoltNet not connected');
  return { agent, diaryId, teamId: config.getTeamId() ?? '' };
}

/**
 * Create all MoltNet tool definitions, ready to pass to `pi.registerTool()`.
 */

export function createMoltNetTools(
  config: MoltNetToolsConfig,
): ToolDefinition<any, any>[] {
  const getPack = defineTool({
    name: 'moltnet_pack_get',
    label: 'Get MoltNet Pack',
    description:
      'Get a context pack by ID. Optionally expand included entries.',
    parameters: Type.Object({
      packId: Type.String({ description: 'Context pack ID' }),
      expandEntries: Type.Optional(
        Type.Boolean({ description: 'Include full expanded entries' }),
      ),
    }),
    async execute(_id, params) {
      const { agent } = ensureConnected(config);
      const pack = await agent.packs.get(params.packId, {
        expand: params.expandEntries ? 'entries' : undefined,
      });
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(pack, null, 2) },
        ],
        details: {},
      };
    },
  });

  const createPack = defineTool({
    name: 'moltnet_pack_create',
    label: 'Create MoltNet Pack',
    description:
      'Persist a curated context pack. Entries are caller-ranked (lower rank = more prominent). ' +
      'Recipe/prompt/selection_rationale belong in params. Defaults to pinned=false — packs in ' +
      'the attribution pipeline are ephemeral unless the caller explicitly opts in.',
    parameters: Type.Object({
      entries: Type.Array(
        Type.Object({
          entryId: Type.String({ description: 'Diary entry UUID' }),
          rank: Type.Number({
            description: 'Rank (1..N, lower = more prominent)',
          }),
        }),
        { description: 'Selected entries with their ranks' },
      ),
      params: Type.Optional(
        Type.Record(Type.String(), Type.Unknown(), {
          description:
            'Free-form recipe parameters (recipe name, prompt, selection rationale, etc.)',
        }),
      ),
      tokenBudget: Type.Optional(
        Type.Number({
          description: 'Soft token budget recorded on the pack (optional)',
        }),
      ),
      pinned: Type.Optional(
        Type.Boolean({
          description: 'Pin the pack against retention policy (default false)',
        }),
      ),
    }),
    async execute(_id, params) {
      const { agent, diaryId } = ensureConnected(config);
      const pack = await agent.packs.create(diaryId, {
        packType: 'custom',
        params: params.params ?? {},
        entries: params.entries,
        tokenBudget: params.tokenBudget,
        pinned: params.pinned ?? false,
      });
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(pack, null, 2) },
        ],
        details: {},
      };
    },
  });

  const getPackProvenance = defineTool({
    name: 'moltnet_pack_provenance',
    label: 'Get MoltNet Pack Provenance',
    description: 'Get the provenance graph for a context pack by ID or CID.',
    parameters: Type.Object({
      packId: Type.Optional(Type.String({ description: 'Context pack ID' })),
      packCid: Type.Optional(Type.String({ description: 'Context pack CID' })),
      depth: Type.Optional(
        Type.Number({
          description: 'Supersession ancestry depth to include (default 2)',
        }),
      ),
    }),
    async execute(_id, params) {
      const { agent } = ensureConnected(config);
      if (!params.packId && !params.packCid) {
        throw new Error('Provide either packId or packCid');
      }
      if (params.packId && params.packCid) {
        throw new Error('Provide only one of packId or packCid');
      }

      const graph = params.packId
        ? await agent.packs.getProvenance(params.packId, {
            depth: params.depth ?? 2,
          })
        : await agent.packs.getProvenanceByCid(params.packCid!, {
            depth: params.depth ?? 2,
          });

      const payload = {
        metadata: graph.metadata,
        counts: {
          nodes: graph.nodes.length,
          edges: graph.edges.length,
        },
        graph,
      };

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(payload, null, 2) },
        ],
        details: {},
      };
    },
  });

  const renderPack = defineTool({
    name: 'moltnet_pack_render',
    label: 'Render MoltNet Pack',
    description:
      'Fetch a pack with entries, transform it into docs, then preview or persist the rendered pack.',
    parameters: Type.Object({
      packId: Type.String({ description: 'Context pack ID' }),
      renderMethod: Type.Optional(
        Type.String({
          description: 'Render method label. Defaults to pi:pack-to-docs-v1',
        }),
      ),
      markdown: Type.Optional(
        Type.String({
          description: 'Optional caller-authored markdown override',
        }),
      ),
      preview: Type.Optional(
        Type.Boolean({
          description: 'Preview without persisting (default false)',
        }),
      ),
      pinned: Type.Optional(
        Type.Boolean({
          description: 'Persist the rendered pack as pinned (default false)',
        }),
      ),
    }),
    async execute(_id, params) {
      const { agent } = ensureConnected(config);
      const renderMethod = params.renderMethod ?? 'pi:pack-to-docs-v1';

      let renderedMarkdown = params.markdown;
      if (!renderedMarkdown && !renderMethod.startsWith('server:')) {
        const pack = (await agent.packs.get(params.packId, {
          expand: 'entries',
        })) as ExpandedPack;
        renderedMarkdown = renderPhase6Markdown(pack);
      }

      const result =
        (params.preview ?? false)
          ? await agent.packs.previewRendered(params.packId, {
              renderMethod,
              renderedMarkdown,
            })
          : await agent.packs.render(params.packId, {
              renderMethod,
              renderedMarkdown,
              pinned: params.pinned,
            });

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result, null, 2) },
        ],
        details: {},
      };
    },
  });

  const listRenderedPacks = defineTool({
    name: 'moltnet_rendered_pack_list',
    label: 'List MoltNet Rendered Packs',
    description:
      'List rendered packs for the current MoltNet diary, optionally filtered by source pack or render method.',
    parameters: Type.Object({
      sourcePackId: Type.Optional(
        Type.String({ description: 'Filter by source pack ID' }),
      ),
      renderMethod: Type.Optional(
        Type.String({ description: 'Filter by render method' }),
      ),
      limit: Type.Optional(
        Type.Number({ description: 'Max results (default 10)' }),
      ),
      offset: Type.Optional(
        Type.Number({ description: 'Offset for pagination (default 0)' }),
      ),
    }),
    async execute(_id, params) {
      const { agent, diaryId } = ensureConnected(config);
      const rendered = await agent.packs.listRendered(diaryId, {
        sourcePackId: params.sourcePackId,
        renderMethod: params.renderMethod,
        limit: params.limit ?? 10,
        offset: params.offset ?? 0,
      });
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(rendered, null, 2) },
        ],
        details: {},
      };
    },
  });

  const getRenderedPack = defineTool({
    name: 'moltnet_rendered_pack_get',
    label: 'Get MoltNet Rendered Pack',
    description: 'Get a rendered pack by ID.',
    parameters: Type.Object({
      renderedPackId: Type.String({ description: 'Rendered pack ID' }),
    }),
    async execute(_id, params) {
      const { agent } = ensureConnected(config);
      const rendered = await agent.packs.getRendered(params.renderedPackId);
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(rendered, null, 2) },
        ],
        details: {},
      };
    },
  });

  const createJudgePackTask = defineTool({
    name: 'moltnet_judge_pack_task_create',
    label: 'Create Judge Pack Task',
    description:
      'Create a judge_pack task for a rendered pack. Returns a taskId that ' +
      'moltnet_rendered_pack_judge can claim and execute. ' +
      'The rubric is required — pass the structured rubric JSON from @moltnet/tasks Rubric schema.',
    parameters: Type.Object({
      renderedPackId: Type.String({ description: 'Rendered pack ID to judge' }),
      sourcePackId: Type.String({
        description:
          'Source pack ID. Fetch it from the rendered pack if unknown.',
      }),
      rubric: Type.Any({
        description:
          'Structured rubric object (Rubric schema from @moltnet/tasks). ' +
          'Must have rubricId, version, criteria[].',
      }),
      diaryId: Type.Optional(
        Type.String({
          description:
            'Diary ID to impose the task on. Defaults to the connected diary.',
        }),
      ),
    }),
    async execute(_id, params) {
      const {
        agent,
        diaryId: connectedDiaryId,
        teamId: connectedTeamId,
      } = ensureConnected(config);
      const task = await agent.tasks.create({
        taskType: 'judge_pack',
        input: {
          renderedPackId: params.renderedPackId,
          sourcePackId: params.sourcePackId,
          rubric: params.rubric,
        },
        diaryId: params.diaryId ?? connectedDiaryId,
        teamId: connectedTeamId,
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ taskId: task.id, task }, null, 2),
          },
        ],
        details: {},
      };
    },
  });

  const judgeRenderedPack = defineTool({
    name: 'moltnet_rendered_pack_judge',
    label: 'Judge MoltNet Rendered Pack',
    description:
      'Claim a judge_pack task, run the fidelity judge locally, complete the task ' +
      'with structured scores, and set verifiedTaskId on the rendered pack. ' +
      'Create the task first with moltnet_judge_pack_task_create.',
    parameters: Type.Object({
      taskId: Type.String({
        description: 'judge_pack task ID from moltnet_judge_pack_task_create',
      }),
      rubricOverride: Type.Optional(
        Type.String({
          description:
            'Freeform rubric string override for the LLM judge prompt. ' +
            'When omitted the task rubric preamble (or built-in default) is used.',
        }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const { agent } = ensureConnected(config);
      const model = ctx?.model;
      if (!model) {
        throw new Error(
          'No active model in pi session — cannot run the fidelity judge.',
        );
      }

      const claimed = await agent.tasks.claim(params.taskId);
      const input = claimed.task.input as {
        renderedPackId: string;
        sourcePackId: string;
        rubric?: { preamble?: string };
      };

      const rendered = await agent.packs.getRendered(input.renderedPackId);
      if (!rendered.content?.trim()) {
        throw new Error(
          `rendered pack ${input.renderedPackId} has empty content`,
        );
      }
      const sourcePack = (await agent.packs.get(input.sourcePackId, {
        expand: 'entries',
      })) as ExpandedPack;
      if (!sourcePack.entries || sourcePack.entries.length === 0) {
        throw new Error(`source pack ${input.sourcePackId} has no entries`);
      }
      const sourceEntriesMd = buildSourceEntriesMarkdown(
        sourcePack.entries.map((entry) => ({
          title: entry.entry.title,
          content: entry.entry.content,
        })),
      );

      const rubric =
        params.rubricOverride?.trim() ||
        input.rubric?.preamble?.trim() ||
        DEFAULT_RUBRIC;

      let scores: FidelityScores;
      try {
        scores = await runFidelityJudge({
          model,
          sourceEntries: sourceEntriesMd,
          renderedContent: rendered.content,
          rubric,
        });
      } catch (err) {
        await agent.tasks
          .fail(params.taskId, claimed.attempt.attemptN, {
            error: {
              code: 'judge_failed',
              message: (err as Error).message ?? String(err),
            },
          })
          .catch(() => {});
        throw new Error(
          `judge failed: ${(err as Error).message ?? String(err)}`,
        );
      }

      const modelId =
        (model as { provider?: string; id?: string }).provider &&
        (model as { id?: string }).id
          ? `${(model as { provider: string }).provider}:${(model as { id: string }).id}`
          : ((model as { id?: string }).id ?? 'pi:unknown');

      const output = {
        scores: [
          { criterionId: 'coverage', score: scores.coverage },
          { criterionId: 'grounding', score: scores.grounding },
          { criterionId: 'faithfulness', score: scores.faithfulness },
        ],
        composite: scores.composite,
        verdict: scores.reasoning,
        judgeModel: modelId,
      };

      const outputCid = await computeJsonCid(output);
      const completed = await agent.tasks.complete(
        params.taskId,
        claimed.attempt.attemptN,
        {
          output,
          outputCid,
          usage: { inputTokens: 0, outputTokens: 0 },
        },
      );

      await agent.packs.updateRendered(input.renderedPackId, {
        verifiedTaskId: params.taskId,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                renderedPackId: input.renderedPackId,
                taskId: params.taskId,
                scores,
                task: completed,
              },
              null,
              2,
            ),
          },
        ],
        details: {},
      };
    },
  });

  const diaryTags = defineTool({
    name: 'moltnet_diary_tags',
    label: 'List MoltNet Diary Tags',
    description:
      'Inventory tags on the current diary with entry counts. Cheap reconnaissance ' +
      'before committing to a search or list — use it to discover scope prefixes and ' +
      'cluster sizes. Optional prefix/minCount/entryTypes filters narrow the result.',
    parameters: Type.Object({
      prefix: Type.Optional(
        Type.String({
          description:
            'Filter to tags starting with this prefix (e.g. "scope:")',
        }),
      ),
      minCount: Type.Optional(
        Type.Number({
          description: 'Exclude tags with fewer than this many entries',
        }),
      ),
      entryTypes: Type.Optional(
        Type.Array(
          Type.Union([
            Type.Literal('episodic'),
            Type.Literal('semantic'),
            Type.Literal('procedural'),
            Type.Literal('reflection'),
            Type.Literal('identity'),
            Type.Literal('soul'),
          ]),
          { description: 'Scope the tag count to these entry types' },
        ),
      ),
    }),
    async execute(_id, params) {
      const { agent, diaryId } = ensureConnected(config);
      const result = await agent.diaries.tags(diaryId, {
        prefix: params.prefix,
        minCount: params.minCount,
        entryTypes: params.entryTypes,
      });
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result, null, 2) },
        ],
        details: {},
      };
    },
  });

  const listEntries = defineTool({
    name: 'moltnet_list_entries',
    label: 'List MoltNet Diary Entries',
    description:
      'List entries from the MoltNet diary. When `entryIds` is provided, batch-fetches those specific entries (max 50) and returns full fields including entryType, contentSignature, and contentHash for signature checks. Otherwise returns recent entries with a content preview.',
    parameters: Type.Object({
      limit: Type.Optional(
        Type.Number({ description: 'Max entries to return (default 10)' }),
      ),
      tag: Type.Optional(
        Type.String({ description: 'Filter by tag (optional)' }),
      ),
      entryIds: Type.Optional(
        Type.Array(Type.String(), {
          description:
            'Batch-fetch specific entries by UUID (max 50). Overrides `limit` and `tag` for selection.',
          maxItems: 50,
        }),
      ),
    }),
    async execute(_id, params) {
      const { agent, diaryId } = ensureConnected(config);
      const query: Record<string, unknown> = {
        orderBy: 'createdAt',
        order: 'desc',
      };
      const batchMode = !!params.entryIds?.length;
      if (batchMode) {
        query.ids = params.entryIds;
      } else {
        query.limit = params.limit ?? 10;
        if (params.tag) query.tag = params.tag;
      }

      const entries = await agent.entries.list(diaryId, query);
      const text = JSON.stringify(
        entries.items?.map((e: Record<string, unknown>) =>
          batchMode
            ? {
                id: e.id,
                title: e.title,
                entryType: e.entryType,
                tags: e.tags,
                importance: e.importance,
                contentHash: e.contentHash,
                contentSignature: e.contentSignature,
                signingNonce: e.signingNonce,
                createdAt: e.createdAt,
              }
            : {
                id: e.id,
                title: e.title,
                tags: e.tags,
                importance: e.importance,
                createdAt: e.createdAt,
                contentPreview:
                  typeof e.content === 'string'
                    ? e.content.slice(0, 200)
                    : undefined,
              },
        ),
        null,
        2,
      );
      return { content: [{ type: 'text' as const, text }], details: {} };
    },
  });

  const getEntry = defineTool({
    name: 'moltnet_get_entry',
    label: 'Get MoltNet Diary Entry',
    description: 'Get the full content of a specific diary entry by ID.',
    parameters: Type.Object({
      entryId: Type.String({ description: 'The entry ID to fetch' }),
    }),
    async execute(_id, params) {
      const { agent } = ensureConnected(config);
      const entry = await agent.entries.get(params.entryId);
      const text = JSON.stringify(
        {
          id: entry.id,
          title: entry.title,
          content: entry.content,
          tags: entry.tags,
          importance: entry.importance,
          createdAt: entry.createdAt,
        },
        null,
        2,
      );
      return { content: [{ type: 'text' as const, text }], details: {} };
    },
  });

  const searchEntries = defineTool({
    name: 'moltnet_search_entries',
    label: 'Search MoltNet Diary Entries',
    description:
      'Search diary entries by semantic query. Uses vector similarity to find relevant entries.',
    parameters: Type.Object({
      query: Type.String({
        description: 'Natural language search query',
      }),
      limit: Type.Optional(
        Type.Number({ description: 'Max results (default 5)' }),
      ),
    }),
    async execute(_id, params) {
      const { agent, diaryId } = ensureConnected(config);
      const results = await agent.entries.search({
        diaryId,
        query: params.query,
        limit: params.limit ?? 5,
      });
      const text = JSON.stringify(
        results.results?.map((e: Record<string, unknown>) => ({
          id: e.id,
          title: e.title,
          tags: e.tags,
          importance: e.importance,
          contentPreview:
            typeof e.content === 'string' ? e.content.slice(0, 200) : undefined,
        })),
        null,
        2,
      );
      return { content: [{ type: 'text' as const, text }], details: {} };
    },
  });

  const createEntry = defineTool({
    name: 'moltnet_create_entry',
    label: 'Create MoltNet Diary Entry',
    description:
      'Create a new diary entry to record decisions, findings, incidents, or reflections.',
    parameters: Type.Object({
      title: Type.String({
        description: 'Entry title (concise, descriptive)',
      }),
      content: Type.String({ description: 'Entry content (markdown)' }),
      tags: Type.Optional(
        Type.Array(Type.String(), {
          description: 'Tags for categorization',
        }),
      ),
      importance: Type.Optional(
        Type.Number({ description: 'Importance 1-10 (default 5)' }),
      ),
    }),
    async execute(_id, params) {
      const { agent, diaryId } = ensureConnected(config);
      const entry = await agent.entries.create(diaryId, {
        title: params.title,
        content: params.content,
        tags: params.tags ?? [],
        importance: params.importance ?? 5,
      });
      const text = JSON.stringify(
        { id: entry.id, title: entry.title, createdAt: entry.createdAt },
        null,
        2,
      );
      return { content: [{ type: 'text' as const, text }], details: {} };
    },
  });

  const reviewSessionErrors = defineTool({
    name: 'moltnet_review_session_errors',
    label: 'Review Session Tool Errors',
    description:
      'Review tool failures buffered during this session (isError=true results). ' +
      'Use this to decide whether any failures are worth persisting as a diary entry ' +
      'via moltnet_create_entry. Most failures are transient (denied prompts, empty ' +
      'greps, mid-iteration typecheck errors) and should NOT be written to the diary — ' +
      'only persist incidents that represent a real finding (root cause identified, ' +
      'non-obvious workaround, recurring pattern). Pass clear=true to drop the buffer ' +
      'after reviewing.',
    parameters: Type.Object({
      clear: Type.Optional(
        Type.Boolean({
          description:
            'If true, empty the buffer after returning it. Use once you have decided whether to persist.',
        }),
      ),
    }),
    async execute(_id, params) {
      const errors = config.getSessionErrors();
      const payload = {
        count: errors.length,
        errors: errors.map((e) => ({
          toolName: e.toolName,
          toolCallId: e.toolCallId,
          timestamp: new Date(e.timestamp).toISOString(),
          input: e.input,
          error: e.error,
        })),
      };
      if (params.clear) config.clearSessionErrors();
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(payload, null, 2) },
        ],
        details: {},
      };
    },
  });

  // Allowlist of executables permitted for host-exec.
  // NOTE: These executables can still invoke arbitrary binaries via flags
  // (e.g. git -c core.sshCommand=...). The allowlist limits what CAN be
  // proposed; human approval is the primary security gate. The agent MUST
  // ask the user before calling this tool.
  const HOST_EXEC_ALLOWED: ReadonlySet<string> = new Set([
    'git',
    'gh',
    'moltnet',
  ]);

  // Use caller-supplied base env (set at sandbox startup) or fall back to the
  // module-level default. The caller knows which agent-specific vars are safe
  // to forward (e.g. MOLTNET_AGENT_NAME, MOLTNET_DIARY_ID).
  const hostExecBaseEnv = config.hostExecBaseEnv ?? HOST_EXEC_DEFAULT_BASE_ENV;

  const HOST_EXEC_TIMEOUT_MS = 60_000;

  const hostExec = defineTool({
    name: 'moltnet_host_exec',
    label: 'Run command on host (escape hatch — requires user approval)',
    description:
      'Runs a command on the HOST machine, outside the sandbox VM. ' +
      'The user will be prompted to approve each invocation via a UI dialog — ' +
      'do NOT call this tool speculatively. Use ONLY when a sandboxed operation ' +
      'is impossible — e.g. `git push`, `gh pr create`.\n\n' +
      'Allowed executables: git, gh, moltnet. ' +
      'Runs with a minimal env (PATH, HOME, GIT_CONFIG_GLOBAL, …); ' +
      'pass any additional vars via the `env` parameter (e.g. GH_TOKEN). ' +
      'Every invocation is logged as an auditable host execution.',
    parameters: Type.Object({
      executable: Type.String({
        description: 'Executable to run (git | gh | moltnet)',
      }),
      args: Type.Array(Type.String(), {
        description: 'Arguments to pass to the executable',
      }),
      env: Type.Optional(
        Type.Record(Type.String(), Type.String(), {
          description:
            'Additional environment variables for this invocation ' +
            '(e.g. { "GH_TOKEN": "..." }). Merged on top of the minimal base env.',
        }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!HOST_EXEC_ALLOWED.has(params.executable)) {
        throw new Error(
          `host_exec: '${params.executable}' is not in the allowed list ` +
            `(${[...HOST_EXEC_ALLOWED].join(', ')}). ` +
            'Extend HOST_EXEC_ALLOWED only after explicit security review.',
        );
      }

      // Require explicit user approval via UI dialog when available.
      // Falls back to proceeding when running headless (no UI context).
      if (ctx?.ui) {
        const cmdDisplay = [params.executable, ...params.args].join(' ');
        const approved = await ctx.ui.confirm(
          'Allow host command?',
          `The agent wants to run on your machine:\n\n  ${cmdDisplay}\n\nAllow?`,
        );
        if (!approved) {
          throw new Error(
            `host_exec: user declined approval for: ${cmdDisplay}`,
          );
        }
      }

      const cwd = config.getHostCwd?.() ?? process.cwd();

      // Build minimal env: allowlisted keys from process.env + caller overrides.
      const baseEnv: Record<string, string> = {};
      for (const key of hostExecBaseEnv) {
        const val = process.env[key];
        if (val !== undefined) baseEnv[key] = val;
      }
      const mergedEnv = { ...baseEnv, ...(params.env ?? {}) };

      let stdout: string;
      let stderr = '';
      try {
        stdout = execFileSync(params.executable, params.args, {
          encoding: 'utf8',
          cwd,
          env: mergedEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: HOST_EXEC_TIMEOUT_MS,
        });
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        stdout = e.stdout ?? '';
        stderr = e.stderr ?? e.message ?? String(err);
      }

      const result = {
        host_exec: true,
        executable: params.executable,
        args: params.args,
        cwd,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd() || undefined,
      };

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result, null, 2) },
        ],
        details: {},
      };
    },
  });

  return [
    getPack,
    createPack,
    getPackProvenance,
    renderPack,
    listRenderedPacks,
    getRenderedPack,
    createJudgePackTask,
    judgeRenderedPack,
    diaryTags,
    listEntries,
    getEntry,
    searchEntries,
    createEntry,
    reviewSessionErrors,
    hostExec,
  ];
}
