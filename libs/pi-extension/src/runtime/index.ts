/**
 * @themoltnet/pi-extension/runtime — headless pi task executor.
 *
 * Separate entry point from the default TUI extension. Import this when
 * wiring a programmatic `AgentRuntime` (local or API mode); it pulls in
 * `@mariozechner/pi-ai`, `pi-coding-agent`, and the MoltNet SDK that the
 * TUI consumers don't necessarily need.
 */
export {
  createPiTaskExecutor,
  executePiTask,
  type ExecutePiTaskOptions,
} from './execute-pi-task.js';
