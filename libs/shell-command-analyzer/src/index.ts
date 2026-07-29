export {
  analyzeCommand,
  type CommandAnalysis,
  DEFAULT_MAX_COMMAND_LENGTH,
  initAnalyzer,
  type InitOptions,
  resetAnalyzer,
  ShellCommandAnalyzer,
  type ToolInvocation,
} from './analyze.js';
// Only functions and types are public — the policy tables (WRAPPERS, GTFOBINS,
// ARBITRARY_CODE_BINARIES, …) stay internal so consumers cannot mutate the
// classification every analyzer instance shares.
export {
  type Capability,
  classifyRisk,
  gtfobinsFunctions,
  type RiskTier,
} from './capabilities.js';
export { GTFOBINS_SOURCE_COMMIT } from './gtfobins.generated.js';
