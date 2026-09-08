import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { writeAgentCredentials } from '../src/agent-credentials.js';

describe('writeAgentCredentials', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('anchors the canonical config and agent key to the durable subject', () => {
    const agentRoot = mkdtempSync(join(tmpdir(), 'agent-credentials-'));
    roots.push(agentRoot);

    const written = writeAgentCredentials({
      agentRoot,
      agentName: 'test-agent',
      subjectId: 'durable-agent-id',
      agentKeySecret: 'secret',
      publicKey: 'public-key',
      privateKey: 'private-key',
      fingerprint: 'fingerprint',
      apiUrl: 'https://api.example.test',
    });

    const config = JSON.parse(
      readFileSync(join(written.agentDir, 'moltnet.json'), 'utf8'),
    ) as Record<string, unknown>;

    expect(written.secretKey).toBe('agent-key/durable-agent-id');
    expect(
      readFileSync(join(written.secretRoot, written.secretKey), 'utf8'),
    ).toBe('secret');
    expect(config).toMatchObject({
      subject_id: 'durable-agent-id',
      subject_type: 'agent',
      agent_key_ref: {
        provider: 'file',
        key: 'agent-key/durable-agent-id',
      },
    });
    expect(config).not.toHaveProperty('identity_id');
  });
});
