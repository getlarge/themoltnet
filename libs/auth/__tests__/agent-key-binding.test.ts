import { describe, expect, it } from 'vitest';

import {
  agentKeyMetadata,
  readAgentKeyMetadataBinding,
} from '../src/agent-key-binding.js';

describe('agent key binding metadata', () => {
  it('accepts legacy schema-v1 team metadata', () => {
    expect(
      readAgentKeyMetadataBinding({
        schema_version: 1,
        subject_type: 'agent',
        team_id: 'team-1',
      }),
    ).toEqual({ bindingScope: 'team', teamId: 'team-1' });
  });

  it('accepts canonical schema-v2 team and identity bindings', () => {
    expect(
      readAgentKeyMetadataBinding({
        schema_version: 2,
        subject_type: 'agent',
        binding_scope: 'team',
        team_id: 'team-1',
      }),
    ).toEqual({ bindingScope: 'team', teamId: 'team-1' });
    expect(
      readAgentKeyMetadataBinding({
        schema_version: 2,
        subject_type: 'agent',
        binding_scope: 'identity',
      }),
    ).toEqual({ bindingScope: 'identity' });
  });

  it.each([
    { schema_version: 2, subject_type: 'agent' },
    {
      schema_version: 2,
      subject_type: 'agent',
      binding_scope: 'identity',
      team_id: 'team-1',
    },
    {
      schema_version: 2,
      subject_type: 'agent',
      binding_scope: 'team',
    },
    {
      schema_version: 1,
      subject_type: 'agent',
      binding_scope: 'identity',
      team_id: 'team-1',
    },
    { schema_version: 1, subject_type: 'agent' },
  ])('rejects missing or conflicting bindings: %j', (metadata) => {
    expect(readAgentKeyMetadataBinding(metadata)).toBeNull();
  });

  it('writes only canonical schema-v2 metadata', () => {
    expect(
      agentKeyMetadata({ bindingScope: 'team', teamId: 'team-1' }),
    ).toEqual({
      schema_version: 2,
      subject_type: 'agent',
      binding_scope: 'team',
      team_id: 'team-1',
    });
    expect(agentKeyMetadata({ bindingScope: 'identity' })).toEqual({
      schema_version: 2,
      subject_type: 'agent',
      binding_scope: 'identity',
    });
  });
});
