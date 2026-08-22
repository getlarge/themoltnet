export type AgentKeyBindingScope = 'identity' | 'team';

export type AgentKeyMetadataBinding =
  | { bindingScope: 'identity' }
  | { bindingScope: 'team'; teamId: string };

function asRecord(value: object | undefined): Record<string, unknown> | null {
  if (!value || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Parse the MoltNet-owned portion of Talos metadata.
 *
 * Schema v2 is the canonical contract and always carries an explicit
 * `binding_scope`. Schema v1 remains accepted only as the legacy team-bound
 * shape that MoltNet previously issued. In particular, an absent team binding
 * is never interpreted as identity scope: identity binding must be explicit.
 */
export function readAgentKeyMetadataBinding(
  value: object | undefined,
): AgentKeyMetadataBinding | null {
  const metadata = asRecord(value);
  if (!metadata || metadata.subject_type !== 'agent') return null;

  if (metadata.schema_version === 1) {
    return typeof metadata.team_id === 'string' &&
      metadata.team_id.length > 0 &&
      metadata.binding_scope === undefined
      ? { bindingScope: 'team', teamId: metadata.team_id }
      : null;
  }

  if (metadata.schema_version !== 2) return null;

  if (metadata.binding_scope === 'identity') {
    return metadata.team_id === undefined ? { bindingScope: 'identity' } : null;
  }

  if (metadata.binding_scope === 'team') {
    return typeof metadata.team_id === 'string' && metadata.team_id.length > 0
      ? { bindingScope: 'team', teamId: metadata.team_id }
      : null;
  }

  return null;
}

export function agentKeyMetadata(
  binding: AgentKeyMetadataBinding,
): Record<string, unknown> {
  return {
    schema_version: 2,
    subject_type: 'agent',
    binding_scope: binding.bindingScope,
    ...(binding.bindingScope === 'team' ? { team_id: binding.teamId } : {}),
  };
}
