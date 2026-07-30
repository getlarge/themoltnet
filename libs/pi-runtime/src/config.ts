import { homedir } from 'node:os';
import path from 'node:path';

/** Resolve Pi's host-side auth/config directory from process configuration. */
export function resolvePiCodingAgentDir(): string {
  return (
    process.env['PI_CODING_AGENT_DIR'] ?? path.join(homedir(), '.pi', 'agent')
  );
}
