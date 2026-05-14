/**
 * Build a fresh isolated `AgentSession` ready for `session.prompt(...)`.
 *
 * Extracted from `executePiTask` so subagents can construct sibling
 * sessions sharing the parent's VM, model, and tool surface but with
 * their own conversation history (`SessionManager.inMemory()`),
 * narrower system prompt, and own submit-tool. See issue #1087.
 *
 * Invariants this helper enforces (NOT configurable):
 *
 *   - `sessionManager: SessionManager.inMemory()` — every session is
 *     conversation-isolated. Persistent sessions would require a
 *     different abstraction.
 *   - `cwd: mountPath` — sessions run against the VM's `/workspace`
 *     mount via Gondolin-routed customTools.
 *   - `agentDir: piAuthDir` — pi auth directory the caller resolved.
 *   - `extensionFactories: [piOtelExtension]` — telemetry is always
 *     wired; the caller picks the span attributes.
 *
 * Things the caller varies per session:
 *
 *   - `appendSystemPrompt` — parent uses `[runtimeInstructor, ...]`;
 *     subagents use a narrower instructor scoped to their task.
 *   - `customTools` — parent gets `[gondolinTools, moltnetTools,
 *     submitTools]`; subagents get the same first two plus their own
 *     `submit_subagent_output` tool with a contract-driven schema.
 *   - `skillsOverride` — parent passes injected task-context skills;
 *     subagents typically pass `() => ({ skills: [], diagnostics: [] })`.
 *   - `otelSpanAttrs` — parent uses task ids; subagents add
 *     `moltnet.subagent.parent_task_id`, `moltnet.subagent.label`,
 *     etc. so traces don't collide.
 */
import type { Api, Model } from '@earendil-works/pi-ai';
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  type LoadSkillsResult,
  SessionManager,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';

import { createPiOtelExtension } from '../otel/index.js';

export interface BuildAgentSessionArgs {
  /** Host directory mounted at /workspace inside the VM. */
  mountPath: string;
  /** pi auth directory (resolved from `PI_CODING_AGENT_DIR` or `~/.pi/agent`). */
  piAuthDir: string;
  /** Resolved pi model handle (provider + model id). */
  modelHandle: Model<Api>;
  /** Pre-built customTools array. Caller composes Gondolin + MoltNet + submit tools. */
  customTools: ToolDefinition[];
  /** System-prompt fragments appended after pi's defaults. Parent passes the
   *  runtime instructor; subagents pass their narrower variant. */
  appendSystemPrompt: string[];
  /** Skills to advertise in `<available_skills>`. Default: empty list. */
  skillsOverride?: () => LoadSkillsResult;
  /** Span attributes merged onto every OTel span the session emits. */
  otelSpanAttrs: Record<string, string | number | boolean>;
  /** Agent name for `gen_ai.agent.name` on the root span. */
  agentName: string;
  /**
   * Parent sessions may persist their conversation history in a daemon-owned
   * directory. Subagents should leave this unset and stay in-memory.
   */
  sessionPersistence?: {
    sessionDir: string;
  };
}

const NO_SKILLS: () => LoadSkillsResult = () => ({
  skills: [],
  diagnostics: [],
});

/**
 * Construct an `AgentSession`. By default it is in-memory; callers may opt
 * parent sessions into daemon-owned file persistence via `sessionPersistence`.
 * The caller is responsible for eventually invoking `session.prompt(...)` and
 * for tearing down — the helper does no lifecycle management beyond
 * construction.
 */
export async function buildAgentSession(
  args: BuildAgentSessionArgs,
): Promise<AgentSession> {
  const piOtelExtension = createPiOtelExtension({
    agentName: args.agentName,
    spanAttributes: args.otelSpanAttrs,
  });

  const resourceLoader = new DefaultResourceLoader({
    cwd: args.mountPath,
    agentDir: args.piAuthDir,
    extensionFactories: [piOtelExtension],
    appendSystemPrompt: args.appendSystemPrompt,
    skillsOverride: args.skillsOverride ?? NO_SKILLS,
  });
  await resourceLoader.reload();

  const sessionManager = args.sessionPersistence
    ? await resolvePersistentSessionManager({
        cwd: args.mountPath,
        sessionDir: args.sessionPersistence.sessionDir,
      })
    : SessionManager.inMemory(args.mountPath);

  const created = await createAgentSession({
    agentDir: args.piAuthDir,
    cwd: args.mountPath,
    model: args.modelHandle,
    customTools: args.customTools,
    sessionManager,
    resourceLoader,
  });
  return created.session;
}

async function resolvePersistentSessionManager(args: {
  cwd: string;
  sessionDir: string;
}): Promise<SessionManager> {
  // Pi populates its session manifest during list(); continueRecent() relies
  // on that state to resolve the session path inside the daemon-owned store.
  await SessionManager.list(args.cwd, args.sessionDir);
  return SessionManager.continueRecent(args.cwd, args.sessionDir);
}
