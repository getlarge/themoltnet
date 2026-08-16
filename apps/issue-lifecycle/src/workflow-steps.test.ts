import { inlineContext } from '@themoltnet/tasks-orchestrator';
import { describe, expect, it, vi } from 'vitest';

import { fakeDeps } from './test-fakes.js';
import type { AcceptedTaskResult, WorkflowContext } from './types.js';
import {
  ensureReadyForReviewComment,
  waitForApprovalLabel,
  waitForGreenPrChecks,
} from './workflow-steps.js';

function decomposedContext(): WorkflowContext {
  const steps = new Map<string, unknown>();
  return {
    ...inlineContext,
    async step(name, fn) {
      if (steps.has(name)) return steps.get(name) as never;
      const value = await fn();
      steps.set(name, value);
      return value;
    },
    beginStep(name) {
      if (steps.has(name)) {
        return Promise.resolve({
          name,
          checkpointName: name,
          done: true as const,
          state: steps.get(name) as never,
        });
      }
      return Promise.resolve({
        name,
        checkpointName: name,
        done: false as const,
      });
    },
    completeStep(handle, value) {
      steps.set(handle.checkpointName, value);
      return Promise.resolve(value);
    },
  };
}

describe('waitForApprovalLabel', () => {
  it('does not consume label-added events while the approval label is stale', async () => {
    const { deps, github } = fakeDeps([]);
    github.approvalResponses = [true, true, false, true];
    const sleeps: string[] = [];
    const events: string[] = [];
    const ctx: WorkflowContext = {
      ...inlineContext,
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
      'wait-plan-approval-label-removal',
      'wait-plan-approval-label-removal',
    ]);
    expect(events).toEqual([]);
  });

  it('replays the armed removal checkpoint without requiring a second removal', async () => {
    const { deps, github } = fakeDeps([]);
    github.approvalResponses = [false, true];
    const durable = decomposedContext();
    let crashBeforeAddition = true;
    const ctx: WorkflowContext = {
      ...durable,
      beginStep(name) {
        if (
          name === 'approval.label.addition-observed' &&
          crashBeforeAddition
        ) {
          crashBeforeAddition = false;
          throw new Error('simulated crash after approval arming');
        }
        return durable.beginStep(name);
      },
    };

    await expect(
      waitForApprovalLabel(
        {
          repo: 'getlarge/themoltnet',
          issueNumber: 1213,
          approvalLabel: 'moltnet:plan-approved',
          pollIntervalSec: 30,
        } as never,
        deps,
        ctx,
      ),
    ).rejects.toThrow('simulated crash after approval arming');

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

    expect(github.approvalResponses).toEqual([]);
  });
});

describe('GitHub retry-safe workflow steps', () => {
  it('reconciles a marker comment after a crash between GitHub and checkpoint persistence', async () => {
    const { deps, github } = fakeDeps([]);
    const input = {
      repo: 'getlarge/themoltnet',
      issueNumber: 1213,
      correlationId: 'crash-gap-marker',
    } as never;
    const reviewResults: AcceptedTaskResult[] = [];
    const crashAfterEffect: WorkflowContext = {
      ...inlineContext,
      async step(_name, fn) {
        await fn();
        throw new Error('simulated crash after GitHub mutation');
      },
    };

    await expect(
      ensureReadyForReviewComment(
        input,
        42,
        reviewResults,
        deps,
        crashAfterEffect,
      ),
    ).rejects.toThrow('simulated crash after GitHub mutation');
    await ensureReadyForReviewComment(
      input,
      42,
      reviewResults,
      deps,
      inlineContext,
    );

    expect(github.comments).toHaveLength(1);
  });

  it('reuses the persisted PR deadline and performs a fresh read after recovery', async () => {
    const { deps, github } = fakeDeps([]);
    github.prResponses = [
      {
        number: 42,
        url: 'https://github.com/getlarge/themoltnet/pull/42',
        merged: false,
        checks: 'pending',
      },
      {
        number: 42,
        url: 'https://github.com/getlarge/themoltnet/pull/42',
        merged: false,
        checks: 'pending',
      },
    ];
    const durable = decomposedContext();
    let firstSleep = true;
    const ctx: WorkflowContext = {
      ...durable,
      sleepFor() {
        if (firstSleep) {
          firstSleep = false;
          throw new Error('simulated worker crash');
        }
        throw new Error('deadline was incorrectly reset');
      },
    };
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000);

    await expect(
      waitForGreenPrChecks(
        {
          repo: 'getlarge/themoltnet',
          pollIntervalSec: 1,
          maxPrPendingPolls: 2,
        } as never,
        42,
        deps,
        ctx,
        0,
      ),
    ).rejects.toThrow('simulated worker crash');

    now.mockReturnValue(4_000);
    await expect(
      waitForGreenPrChecks(
        {
          repo: 'getlarge/themoltnet',
          pollIntervalSec: 1,
          maxPrPendingPolls: 2,
        } as never,
        42,
        deps,
        ctx,
        0,
      ),
    ).rejects.toThrow('checks exceeded its durable deadline');
    expect(github.prResponses).toEqual([]);
    now.mockRestore();
  });
});
