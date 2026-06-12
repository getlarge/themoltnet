import { describe, expect, it } from 'vitest';

import { fakeDeps } from './test-fakes.js';
import type { WorkflowContext } from './types.js';
import { waitForApprovalLabel } from './workflow-steps.js';

describe('waitForApprovalLabel', () => {
  it('does not consume label-added events while the approval label is stale', async () => {
    const { deps, github } = fakeDeps([]);
    github.approvalResponses = [true, true, false, true];
    const sleeps: string[] = [];
    const events: string[] = [];
    const ctx: WorkflowContext = {
      step(_name, fn) {
        return fn();
      },
      sleepFor(name) {
        sleeps.push(name);
        return Promise.resolve();
      },
      awaitEvent(eventName) {
        events.push(eventName);
        return Promise.resolve({});
      },
    };

    await waitForApprovalLabel(
      {
        repo: 'getlarge/themoltnet',
        issueNumber: 1213,
        approvalLabel: 'moltnet:plan-approved',
        pollIntervalSec: 30,
      } as never,
      deps,
      ctx,
    );

    expect(sleeps).toEqual([
      'wait-plan-approval-label',
      'wait-plan-approval-label',
    ]);
    expect(events).toEqual([
      'github.issue.label:getlarge/themoltnet:1213:moltnet:plan-approved',
    ]);
  });
});
