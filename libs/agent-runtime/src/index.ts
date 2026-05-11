/**
 * @moltnet/agent-runtime — coding-agent-agnostic Task execution loop.
 *
 * Exposes a pluggable `AgentRuntime` that pulls tasks from a `TaskSource`,
 * reports lifecycle events through a `TaskReporter`, and delegates the
 * actual execution to an injected `executeTask` function. Concrete
 * executors (pi + Gondolin, Codex, direct Anthropic SDK, …) live in their
 * own packages.
 */
// Side-effect import — registers built-in subagent output contracts at
// module init. Must run before any consumer resolves contracts by name.
import './built-in-contract-registrations.js';

export * from './context-bindings.js';
export * from './output-tools.js';
export * from './prompts/index.js';
export * from './reporters/index.js';
export * from './runtime.js';
export * from './sources/index.js';
export {
  __resetSubagentOutputContractsForTests,
  getSubagentOutputContract,
  listSubagentOutputContracts,
  registerSubagentOutputContract,
  type SubagentOutputContract,
} from './subagent-output-contracts.js';
export * from '@moltnet/tasks';
