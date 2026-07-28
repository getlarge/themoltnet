import type { Agent } from '@themoltnet/sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  MAX_REVIEW_DIFF_BYTES,
  REVIEW_DIFF_CONTENT_TYPE,
  stageReviewDiff,
} from './diff-artifact.js';

describe('stageReviewDiff', () => {
  it('stages the diff once with team scope and returns bindable metadata', async () => {
    const stage = vi.fn().mockResolvedValue({
      cid: 'bafkreidiff',
      contentType: REVIEW_DIFF_CONTENT_TYPE,
      sizeBytes: 4,
    });
    const agent = {
      tasks: { artifacts: { stage } },
    } as unknown as Agent;

    await expect(stageReviewDiff(agent, 'team-1', 'diff')).resolves.toEqual({
      cid: 'bafkreidiff',
      title: 'pull-request.diff',
      contentType: REVIEW_DIFF_CONTENT_TYPE,
    });
    expect(stage).toHaveBeenCalledOnce();
    expect(stage).toHaveBeenCalledWith(
      Buffer.from('diff'),
      { contentType: REVIEW_DIFF_CONTENT_TYPE },
      { teamId: 'team-1' },
    );
  });

  it('rejects oversized bytes before staging', async () => {
    const stage = vi.fn();
    const agent = {
      tasks: { artifacts: { stage } },
    } as unknown as Agent;

    await expect(
      stageReviewDiff(agent, 'team-1', 'x'.repeat(MAX_REVIEW_DIFF_BYTES + 1)),
    ).rejects.toThrow(/exceeds the .*byte limit/);
    expect(stage).not.toHaveBeenCalled();
  });
});
