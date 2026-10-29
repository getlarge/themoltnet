import { describe, expect, it, vi } from 'vitest';

import type { Handoff } from './contracts.js';
import type { GithubRequest } from './github-coordination.js';
import { issueDigest } from './github-coordination.js';
import { createGithubDeliveryRepository } from './github-delivery.js';

const handoff: Handoff = {
  version: 1,
  workItem: { provider: 'github', repository: 'owner/repo', key: '1' },
  generation: 'approval',
  correlationId: 'case',
  revision: {
    base: 'base',
    head: 'head',
    policyDigest: 'policy',
    briefDigest: 'brief',
  },
  acceptedWork: { taskId: 'task', attempt: 1, outputCid: 'cid' },
};

describe('delivery publication control', () => {
  it.each([
    { state: 'open', labels: ['approved'] },
    { state: 'open', labels: ['approved', 'eligible', 'paused'] },
    { state: 'open', labels: ['approved', 'eligible', 'cancelled'] },
    { state: 'closed', labels: ['approved', 'eligible'] },
  ])('does not mutate a no-longer-admitted issue: %j', async (state) => {
    const issue = { title: 'Task', body: 'Brief', ...state };
    const request = vi
      .fn<GithubRequest>()
      .mockImplementation((path) =>
        Promise.resolve(path.includes('/comments?') ? [] : issue),
      );
    const readAcceptedOutput = vi.fn().mockResolvedValue({});
    const port = createGithubDeliveryRepository({
      request,
      repository: 'owner/repo',
      issueNumber: 1,
      appUserId: 42,
      presentation: {
        presentedAt: '2026-10-29T10:00:00Z',
        issueDigest: issueDigest(issue),
        briefDigest: 'brief',
      },
      policy: {
        eligibleLabels: ['eligible'],
        approvalLabel: 'approved',
        pauseLabel: 'paused',
        cancelLabel: 'cancelled',
        allowedPermissions: ['write'],
        baseBranch: 'main',
        allowedPaths: ['docs/'],
        protectedPaths: [],
        labels: { stages: { delivered: 'stage:delivered' } },
        deliveredStage: 'delivered',
      },
      readAcceptedOutput,
    });
    expect(await port.publish(handoff, 'publication-key')).toBe(false);
    expect(request.mock.calls.every(([, method]) => method === 'GET')).toBe(
      true,
    );
    expect(readAcceptedOutput).not.toHaveBeenCalled();
  });
});
