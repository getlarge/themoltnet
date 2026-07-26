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
export {
  ARBITRARY_CODE_BINARIES,
  classifyRisk,
  ESCAPE_FLAG_SPECS,
  type EscapeFlagSpec,
  FIND_EXEC_FLAGS,
  gtfobinsFunctions,
  type RiskTier,
  WRAPPERS,
  type WrapperSpec,
} from './capabilities.js';
export { GTFOBINS, GTFOBINS_SOURCE_COMMIT } from './gtfobins.generated.js';
