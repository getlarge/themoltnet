import { inlineContext } from '@themoltnet/tasks-orchestrator';
import { replayContext } from '@themoltnet/tasks-orchestrator/testing';
import { describe, expect, it, vi } from 'vitest';

import { fakeDeps } from './test-fakes.js';
import type { AcceptedTaskResult, WorkflowContext } from './types.js';
import {
  ensureReadyForReviewComment,
  waitForApprovalLabel,
  waitForGreenPrChecks,
} from './workflow-steps.js';

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
    const durable = replayContext();
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

    durable.resetForReplay();
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
  it('does not trust or update a marker forged by a human commenter', async () => {
    const { deps, github } = fakeDeps([]);
    const marker =
      '<!-- moltnet-issue-lifecycle:ready-for-review:forged-marker -->';
    github.comments = [
      {
        id: 99,
        body: `${marker}\nattacker-controlled text`,
        author: { login: 'contributor', type: 'User' },
      },
    ];

    await ensureReadyForReviewComment(
      {
        repo: 'getlarge/themoltnet',
        issueNumber: 1213,
        correlationId: 'forged-marker',
      } as never,
      42,
      [],
      deps,
      inlineContext,
    );

    expect(github.comments).toHaveLength(2);
    expect(github.comments[0].body).toContain('attacker-controlled text');
    expect(github.comments[1].author?.type).toBe('Bot');
  });

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
    const durable = replayContext();
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

    durable.resetForReplay();
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
