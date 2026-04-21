/**
 * @moltnet/agent-runtime — coding-agent-agnostic Task execution loop.
 *
 * Exposes a pluggable `AgentRuntime` that pulls tasks from a `TaskSource`,
 * reports lifecycle events through a `TaskReporter`, and delegates the
 * actual execution to an injected `executeTask` function. Concrete
 * executors (pi + Gondolin, Codex, direct Anthropic SDK, …) live in their
 * own packages.
 */
export * from './prompts/index.js';
export * from './reporters/index.js';
export * from './runtime.js';
export * from './sources/index.js';
