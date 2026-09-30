import { homedir } from 'node:os';
import path from 'node:path';

/** Resolve Pi's host-side auth/config directory from process configuration. */
export function resolvePiCodingAgentDir(): string {
  return (
    process.env['PI_CODING_AGENT_DIR'] ?? path.join(homedir(), '.pi', 'agent')
  );
}

/** Optional credentials and model selection for the live structured-tool probe. */
export function readLiveStructuredOutputConfig() {
  return {
    provider: process.env['MOLTNET_LIVE_STRUCTURED_PROVIDER'],
    api: process.env['MOLTNET_LIVE_STRUCTURED_API'],
    baseUrl: process.env['MOLTNET_LIVE_STRUCTURED_BASE_URL'],
    modelId: process.env['MOLTNET_LIVE_STRUCTURED_MODEL'],
    apiKey: process.env['MOLTNET_LIVE_STRUCTURED_API_KEY'],
  };
}
