import { createHash } from 'node:crypto';

import {
  type Agent,
  type AgentSigningCapability,
  computeContentCid,
} from '@themoltnet/sdk';
import type { WorkflowContext } from '@themoltnet/tasks-orchestrator';

import { type Finding, type Handoff, sameRevision } from './contracts.js';

export interface OutcomeInput {
  diaryId: string;
  teamId: string;
  handoff: Handoff;
  observation: {
    state: 'merged' | 'closed-unmerged' | 'cancelled';
    occurredAt: string;
    providerUrl: string;
    mergeCommit?: string;
  };
  /** Explicit adjudications, not inferred from closed or resolved GitHub threads. */
  findings: Finding[];
}
export type OutcomeResult =
  | { recorded: true; entryId: string; contentHash: string }
  | { recorded: false; reason: 'superseded' };

/** One durable owner per closure; callers spawn this stage with a closure-specific idempotency key. */
export async function runOutcome(
  input: OutcomeInput,
  deps: {
    agent: Agent;
    signer: Pick<AgentSigningCapability, 'signDiaryEntry'>;
    isCurrent(this: void, input: OutcomeInput): Promise<boolean>;
  },
  ctx: WorkflowContext,
): Promise<OutcomeResult> {
  if (!ctx.executionId)
    throw new Error('Outcome recording requires a durable execution identity');
  const frozen = await ctx.step('outcome.input', () => {
    if (
      !input.diaryId ||
      !input.teamId ||
      !input.handoff.generation ||
      !Number.isFinite(Date.parse(input.observation.occurredAt)) ||
      !['merged', 'closed-unmerged', 'cancelled'].includes(
        input.observation.state,
      ) ||
      !input.observation.providerUrl ||
      new Set(input.findings.map((finding) => finding.id)).size !==
        input.findings.length
    )
      throw new Error('Invalid outcome observation');
    return Promise.resolve(structuredClone(input));
  });
  const principal = await deps.agent.agents.whoami();
  if (principal.subjectType !== 'agent')
    throw new Error('Outcome recording requires an agent principal');
  const owner = await ctx.step('outcome.principal', () =>
    Promise.resolve(principal.subjectId),
  );
  if (owner !== principal.subjectId)
    throw new Error('Outcome principal changed during recovery');
  const operation = createHash('sha256')
    .update(
      JSON.stringify([
        frozen.handoff.workItem.provider,
        frozen.handoff.workItem.repository,
        frozen.handoff.workItem.key,
        frozen.handoff.generation,
        frozen.observation.state,
        frozen.observation.occurredAt,
      ]),
    )
    .digest('hex');
  const tag = `sdlc-outcome:${operation}`;
  const body = {
    entryType: 'episodic' as const,
    title: `SDLC outcome: ${frozen.handoff.workItem.repository}#${frozen.handoff.workItem.key}`,
    tags: ['sdlc:outcome', tag],
    importance: 5,
    content: [
      'Observed repository outcome and separately recorded finding adjudications.',
      'A merge or closed conversation does not establish that a finding was fixed.',
      '',
      JSON.stringify(
        {
          version: 1,
          handoff: frozen.handoff,
          observation: frozen.observation,
          findings: frozen.findings.map((finding) => ({
            ...finding,
            verifiedForRevision: Boolean(
              finding.verification &&
              finding.verification.evidence.trim() &&
              sameRevision(
                finding.verification.revision,
                frozen.handoff.revision,
              ),
            ),
          })),
        },
        null,
        2,
      ),
      '',
      '<metadata>',
      'operator: automated',
      'tool: moltnet-sdlc',
      `timestamp: ${frozen.observation.occurredAt}`,
      'scope: sdlc',
      `refs: ${frozen.observation.providerUrl}`,
      `agent-id: ${owner}`,
      '</metadata>',
    ].join('\n'),
  };
  const contentHash = computeContentCid(
    body.entryType,
    body.title,
    body.content,
    body.tags,
  );
  const existing = async (): Promise<OutcomeResult | undefined> => {
    const page = await deps.agent.entries.list(frozen.diaryId, {
      tags: [tag],
      limit: 2,
    });
    if (page.items.length > 1)
      throw new Error('Multiple diary outcomes for one closure');
    const entry = page.items[0];
    if (!entry) return undefined;
    if (
      entry.contentHash !== contentHash ||
      entry.creator.kind !== 'agent' ||
      entry.creator.agentId !== owner ||
      !entry.contentSignature ||
      !(await deps.agent.entries.verify(entry.id)).valid
    )
      throw new Error(
        'Existing diary outcome does not match signed observation',
      );
    return { recorded: true, entryId: entry.id, contentHash };
  };
  // Reconcile a completed write before requiring the closure to remain current.
  const recorded = await existing();
  if (recorded) return recorded;
  if (!(await deps.isCurrent(frozen)))
    return { recorded: false, reason: 'superseded' };
  await ctx.step('outcome.source', async () => {
    const work = frozen.handoff.acceptedWork;
    const options = { teamId: frozen.teamId };
    const task = await deps.agent.tasks.get(work.taskId, options);
    const attempts = await deps.agent.tasks.listAttempts(work.taskId, options);
    const attempt = attempts.find((value) => value.attemptN === work.attempt);
    if (
      task.id !== work.taskId ||
      task.status !== 'completed' ||
      task.diaryId !== frozen.diaryId ||
      task.correlationId !== frozen.handoff.correlationId ||
      task.acceptedAttemptN !== work.attempt ||
      !attempt ||
      attempt.taskId !== task.id ||
      attempt.status !== 'completed' ||
      attempt.outputCid !== work.outputCid
    )
      throw new Error(
        'Outcome source does not match accepted delivery and diary',
      );
    return true;
  });
  const signing = await ctx.step('outcome.signing-request', () =>
    deps.agent.crypto.signingRequests.create({
      message: contentHash,
      purpose: tag,
      verificationMethod: 'agent-ed25519',
    }),
  );
  await ctx.step('outcome.sign', async () => {
    let request = await deps.agent.crypto.signingRequests.get(signing.id);
    if (
      request.message !== contentHash ||
      request.requestedBy.kind !== 'agent' ||
      request.requestedBy.agentId !== owner
    )
      throw new Error(
        'Outcome signing request does not match principal and content',
      );
    if (request.status === 'pending') {
      await deps.signer.signDiaryEntry({ signingRequestId: signing.id });
      request = await deps.agent.crypto.signingRequests.get(signing.id);
    }
    if (request.status !== 'completed' || !request.valid || !request.signature)
      throw new Error('Outcome signature is not valid and complete');
    return true;
  });
  return ctx.step('outcome.entry', async () => {
    const prior = await existing();
    if (prior) return prior;
    if (!(await deps.isCurrent(frozen)))
      return { recorded: false, reason: 'superseded' } as const;
    try {
      await deps.agent.entries.create(frozen.diaryId, {
        ...body,
        signingRequestId: signing.id,
      });
    } catch (error) {
      // The server uniquely constrains content signatures. Reusing the saved
      // signing request closes the entry-create/checkpoint crash gap.
      const reconciled = await existing();
      if (reconciled) return reconciled;
      throw error;
    }
    const created = await existing();
    if (!created)
      throw new Error('Signed outcome entry could not be reconciled');
    return created;
  });
}
