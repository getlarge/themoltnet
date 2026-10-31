import {
  beginWorkflowStep,
  completeWorkflowStep,
  createTaskStep,
  type WorkflowContext,
} from '@themoltnet/tasks-orchestrator';

import type {
  ConvergenceInput,
  Finding,
  Revision,
  Verdict,
} from './contracts.js';
import { retainFindings } from './finding-ledger.js';
import { evaluateConvergence } from './verdict.js';

export interface ConvergencePolicy {
  maxRepairRounds: number;
  pollIntervalSec: number;
  evidenceTimeoutSec: number;
  repairTimeoutSec: number;
}

export interface RepairReceipt {
  taskId: string;
}
export type RepairState = 'pending' | 'accepted' | 'failed';

/** External effects must reconcile the key before checking current preconditions. */
export interface ConvergencePort {
  observe(): Promise<
    Omit<ConvergenceInput, 'repairRounds' | 'maxRepairRounds'>
  >;
  /** Return the existing receipt on retry; otherwise check revision/control before dispatch. */
  startRepair(args: {
    key: string;
    round: number;
    deadline: number;
    revision: Revision;
    reasons: string[];
  }): Promise<RepairReceipt | null>;
  repairState(receipt: RepairReceipt): Promise<RepairState>;
  /** Idempotently revoke further mutation, including an already-running task. */
  cancelRepair(receipt: RepairReceipt, key: string): Promise<void>;
  /** Reconcile publication by key and validate revision/control at the provider boundary. */
  publish(args: {
    key: string;
    revision: Revision;
    verdict: Verdict;
  }): Promise<boolean>;
}

export interface ConvergenceResult {
  verdict: Verdict;
  revision: Revision;
  repairs: RepairReceipt[];
  /** Retained adjudications for the independently dispatched outcome stage. */
  findings: Finding[];
  published: boolean;
}

/** One independently runnable convergence stage; never merges or creates issues. */
export async function runConvergence(
  policy: ConvergencePolicy,
  port: ConvergencePort,
  ctx: WorkflowContext,
  now: () => number = Date.now,
): Promise<ConvergenceResult> {
  if (!ctx.executionId)
    throw new Error('Convergence requires a stable execution identity');
  const limits = await ctx.step('convergence.policy', () => {
    if (
      !Number.isInteger(policy.maxRepairRounds) ||
      policy.maxRepairRounds < 0 ||
      [
        policy.pollIntervalSec,
        policy.evidenceTimeoutSec,
        policy.repairTimeoutSec,
      ].some((n) => !Number.isSafeInteger(n) || n <= 0)
    )
      throw new Error('Invalid convergence limits');
    return Promise.resolve({ ...policy });
  });
  const repairs: RepairReceipt[] = [];
  let retained: Finding[] = [];
  for (let round = 0; round <= limits.maxRepairRounds; round += 1) {
    const name = `convergence.round.${round}`;
    const deadline = await ctx.step(`${name}.deadline`, () =>
      Promise.resolve(now() + limits.evidenceTimeoutSec * 1000),
    );
    const gate = await beginWorkflowStep<{
      revision: Revision;
      verdict: Verdict;
      findings: Finding[];
    }>(ctx, `${name}.evidence`);
    let decision: { revision: Revision; verdict: Verdict; findings: Finding[] };
    if (gate.done) decision = gate.state;
    else {
      for (;;) {
        const observation = await port.observe();
        const recorded = await ctx.step(`${name}.findings`, () =>
          Promise.resolve(retainFindings(retained, observation)),
        );
        // A replay may load an earlier poll's ledger; fresh observations can only
        // update it explicitly, never erase a previously seen problem.
        const findings = retainFindings(recorded, observation);
        retained = findings;
        let verdict = evaluateConvergence({
          ...observation,
          retainedFindings: findings,
          repairRounds: round,
          maxRepairRounds: limits.maxRepairRounds,
        });
        if (verdict.status === 'waiting' && now() >= deadline)
          verdict = {
            status: 'needs-human',
            reasons: ['evidence:timeout', ...verdict.reasons],
          };
        if (verdict.status !== 'waiting') {
          decision = await completeWorkflowStep(ctx, gate, {
            revision: observation.current,
            verdict,
            findings,
          });
          break;
        }
        await ctx.sleepFor(`${name}.evidence.poll`, limits.pollIntervalSec);
      }
    }
    retained = decision.findings;
    if (decision.verdict.status !== 'repair') return finish(decision);
    const repairDeadline = await ctx.step(`${name}.repair.deadline`, () =>
      Promise.resolve(now() + limits.repairTimeoutSec * 1000),
    );
    const receipt = await createTaskStep(
      ctx,
      `${name}.repair.create`,
      ({ idempotencyKey }) =>
        port.startRepair({
          key: requireKey(idempotencyKey),
          round: round + 1,
          deadline: repairDeadline,
          revision: decision.revision,
          reasons: decision.verdict.reasons,
        }),
    );
    if (!receipt)
      return finish({
        ...decision,
        verdict: { status: 'needs-human', reasons: ['repair:superseded'] },
      });
    repairs.push(receipt);
    const repairGate = await beginWorkflowStep<
      'accepted' | 'failed' | 'paused' | 'cancelled' | 'timeout' | 'superseded'
    >(ctx, `${name}.repair.outcome`);
    let outcome:
      | 'accepted'
      | 'failed'
      | 'paused'
      | 'cancelled'
      | 'timeout'
      | 'superseded';
    if (repairGate.done) outcome = repairGate.state;
    else {
      for (;;) {
        const observation = await port.observe();
        const state = await port.repairState(receipt);
        const terminal =
          observation.control !== 'active'
            ? observation.control
            : observation.current.briefDigest !==
                  decision.revision.briefDigest ||
                observation.current.policyDigest !==
                  decision.revision.policyDigest
              ? 'superseded'
              : state !== 'pending'
                ? state
                : now() >= repairDeadline
                  ? 'timeout'
                  : undefined;
        if (terminal) {
          outcome = await completeWorkflowStep(ctx, repairGate, terminal);
          break;
        }
        await ctx.sleepFor(`${name}.repair.poll`, limits.pollIntervalSec);
      }
    }
    if (outcome !== 'accepted') {
      if (outcome !== 'failed')
        await createTaskStep(
          ctx,
          `${name}.repair.cancel`,
          async ({ idempotencyKey }) => {
            await port.cancelRepair(receipt, requireKey(idempotencyKey));
            return true;
          },
        );
      return finish({
        ...decision,
        verdict: {
          status:
            outcome === 'paused' || outcome === 'cancelled'
              ? outcome
              : 'needs-human',
          reasons: [`repair:${outcome}`],
        },
      });
    }
  }
  throw new Error('Convergence exceeded its repair budget');

  async function finish(decision: {
    revision: Revision;
    verdict: Verdict;
    findings: Finding[];
  }): Promise<ConvergenceResult> {
    const published = await createTaskStep(
      ctx,
      'convergence.publish',
      ({ idempotencyKey }) =>
        port.publish({
          key: requireKey(idempotencyKey),
          revision: decision.revision,
          verdict: decision.verdict,
        }),
    );
    return {
      revision: decision.revision,
      verdict: decision.verdict,
      repairs,
      findings: structuredClone(decision.findings),
      published,
    };
  }
}

function requireKey(key: string | undefined): string {
  if (!key) throw new Error('Missing durable operation identity');
  return key;
}
