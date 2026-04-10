import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:8000';

describe('Team governance', () => {
  let agentToken: string;
  let teamId: string;
  let targetAgentId: string;

  beforeAll(async () => {
    // Setup: create agents and team (simplified)
    agentToken = 'test-bearer-token';
    teamId = 'test-team-id';
    targetAgentId = 'target-agent-id';
  });

  it('should initiate ownership transfer', async () => {
    const res = await fetch(`${BASE_URL}/teams/${teamId}/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agentToken}`,
      },
      body: JSON.stringify({ target_agent_id: targetAgentId }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.status).toBe('pending');
  });

  it('should list pending transfers', async () => {
    const res = await fetch(`${BASE_URL}/teams/${teamId}/transfers?status=pending`, {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.items)).toBe(true);
  });

  it('should accept a transfer', async () => {
    const res = await fetch(`${BASE_URL}/teams/${teamId}/transfer/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agentToken}`,
      },
      body: JSON.stringify({ transfer_id: 'transfer-id' }),
    });
    expect(res.status).toBe(200);
  });

  it('should reject a transfer', async () => {
    const res = await fetch(`${BASE_URL}/teams/${teamId}/transfer/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agentToken}`,
      },
      body: JSON.stringify({ transfer_id: 'transfer-id', reason: 'Not ready' }),
    });
    expect(res.status).toBe(200);
  });

  it('should create a team', async () => {
    const res = await fetch(`${BASE_URL}/teams`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agentToken}`,
      },
      body: JSON.stringify({ name: 'new-team' }),
    });
    expect(res.status).toBe(201);
  });
});
