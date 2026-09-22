import type {} from '@fastify/swagger';

// Source-only integration ports; excluded from published exports.
export { runAgentServer } from './cli/server.js';
export { ConnectionSettingsStore } from './lib/agent-server/connection-settings.js';
export { loadAgentActivation } from './lib/agent-server/identity.js';
export { RuntimeRegistry } from './lib/agent-server/runtime-registry.js';
export { AgentServerStore } from './lib/agent-server/store.js';
export { captureTeamCredential } from './lib/agent-server/team-credentials.js';
export {
  projectRunOptionDefs,
  resolveRunProjectSelection,
} from './lib/run-project-selection.js';
