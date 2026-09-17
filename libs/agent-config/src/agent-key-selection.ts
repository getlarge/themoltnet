import {
  type AgentKeyConfiguration,
  agentKeyKey,
  type OAuth2Config,
  type SecretReference,
} from './config.js';

/** Presence only: a configured but invalid credential must fail resolution. */
export function hasAgentKeyConfiguration(
  config: AgentKeyConfiguration,
): boolean {
  return (
    config.agent_key_ref !== undefined ||
    Object.keys(config.agent_key_refs ?? {}).length > 0
  );
}

export function hasUsableCredentialConfiguration(
  config: AgentKeyConfiguration & { oauth2?: OAuth2Config },
): boolean {
  return hasAgentKeyConfiguration(config) || Boolean(config.oauth2?.client_id);
}

export interface SelectedAgentKey {
  reference: SecretReference;
  /** Absent for the compatibility fallback, even when a team was selected. */
  teamId?: string;
}

/** Select once, before contacting any provider. Failure never tries another grant. */
export function selectAgentKeyReference(
  config: AgentKeyConfiguration,
  selectedTeam?: string,
): SelectedAgentKey | null {
  const team = selectedTeam?.trim();
  const entries = config.agent_key_refs ?? {};
  if (team && Object.hasOwn(entries, team)) {
    return { reference: entries[team], teamId: team };
  }
  if (config.agent_key_ref !== undefined) {
    return { reference: config.agent_key_ref };
  }
  const teams = Object.keys(entries);
  if (!teams.length) return null;
  if (!team && teams.length === 1) {
    if (!teams[0].trim())
      throw new Error('Team key map contains an empty team ID');
    return { reference: entries[teams[0]], teamId: teams[0] };
  }
  throw new Error(
    team
      ? 'No agent key configured for the selected team; enroll that team first'
      : 'Multiple team agent keys configured; select a team explicitly',
  );
}

/** Provider-independent binding, also used before storing a reference. */
export function assertAgentKeyReferenceBinding(
  selection: SelectedAgentKey,
  subjectId?: string,
): void {
  const { reference, teamId } = selection;
  const subject = subjectId?.trim();
  if (!subject || (teamId !== undefined && !teamId.trim())) {
    throw new Error(
      'Agent key binding requires subject_id and a nonempty team',
    );
  }
  const expected = agentKeyKey(subject, teamId);
  if (
    !reference ||
    !/^[a-z][a-z0-9-]*$/.test(reference.provider) ||
    reference.provider === 'env' ||
    (reference.key !== expected &&
      !(
        reference.provider === 'file' &&
        reference.key === expected.replaceAll('/', '.')
      ))
  ) {
    throw new Error(
      'Agent key reference is not bound to this subject and team',
    );
  }
}
