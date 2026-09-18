import { assertAgentKeyReferenceBinding } from './agent-key-selection.js';
import {
  type MoltNetConfig,
  type SecretReference,
  updateConfig,
} from './config.js';

export async function updateTeamAgentKeyReference(
  subjectId: string,
  teamId: string,
  reference: SecretReference,
  configDir?: string,
  beforeCommit?: (config: MoltNetConfig) => Promise<void>,
): Promise<void> {
  if (teamId !== teamId.trim())
    throw new Error('Team ID must not contain surrounding whitespace');
  if (!teamId.trim()) throw new Error('Team ID is required');
  assertAgentKeyReferenceBinding({ reference, teamId }, subjectId);
  await updateConfig(async (config) => {
    if (config.subject_id !== subjectId) {
      throw new Error('Credentials file subject anchor changed before update');
    }
    await beforeCommit?.(config);
    config.agent_key_refs = { ...config.agent_key_refs, [teamId]: reference };
  }, configDir);
}
