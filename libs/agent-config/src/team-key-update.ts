import { assertAgentKeyReferenceBinding } from './agent-key-selection.js';
import { type SecretReference, updateConfig } from './config.js';

export async function updateTeamAgentKeyReference(
  subjectId: string,
  teamId: string,
  reference: SecretReference,
  configDir?: string,
): Promise<void> {
  if (!teamId.trim()) throw new Error('Team ID is required');
  assertAgentKeyReferenceBinding({ reference, teamId }, subjectId);
  await updateConfig((config) => {
    if (config.subject_id !== subjectId) {
      throw new Error('Credentials file subject anchor changed before update');
    }
    config.agent_key_refs = { ...config.agent_key_refs, [teamId]: reference };
  }, configDir);
}
