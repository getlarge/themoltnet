import { randomUUID } from 'node:crypto';

// eslint-disable-next-line @nx/enforce-module-boundaries -- Node E2E fixture setup.
import { buildE2EExecutorManifest } from '@moltnet/bootstrap/testing/durable';
import {
  buildExecutorCompleteAttestationPayload,
  buildExecutorRegistrationAttestationPayload,
  computeExecutorManifestCid,
  computeJsonCid,
  cryptoService,
  signExecutorAttestation,
} from '@moltnet/crypto-service';
import {
  type AssessmentResult,
  type BriefPresentation,
  type ConvergenceResult,
  createConvergenceApp,
  type Handoff,
  type OutcomeInput,
  prepareBrief,
  SDLC_ASSESSMENT_TASK,
  SDLC_CONVERGENCE_TASK,
  SDLC_DELIVERY_TASK,
  SDLC_OUTCOME_TASK,
  SDLC_PREPARATION_TASK,
  SDLC_REVIEW_START_TASK,
} from '@moltnet/sdlc';
import {
  createGithubEvidenceObserver,
  type GithubRequest,
  issueDigest,
} from '@moltnet/sdlc/github';
import {
  createGithubMoltNetAssessmentApp,
  createGithubMoltNetDeliveryApp,
  createGithubMoltNetOutcomeApp,
  createGithubMoltNetReviewStartApp,
  createGithubPreparationApp,
  type GithubDeliveryInput,
  type GithubReviewStartInput,
} from '@moltnet/sdlc/github-moltnet';
import { createMoltNetRepairAdapter } from '@moltnet/sdlc/moltnet';
import {
  type Agent,
  buildRubricSuccessCriteria,
  connect,
} from '@themoltnet/sdk';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createAgent, pollUntil, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

const ABSURD_URL =
  process.env.ORCHESTRATION_ABSURD_URL ??
  'postgresql://issue_lifecycle:issue_lifecycle_secret@localhost:55434/issue_lifecycle';

describe('SDLC repair adapter against the task service', () => {
  let harness: TestHarness;
  let proposer: TestAgent;
  let agent: Agent;
  const taskIds: string[] = [];
  beforeAll(async () => {
    harness = await createTestHarness();
    proposer = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });
    agent = await connect({
      apiUrl: harness.baseUrl,
      clientId: proposer.clientId,
      clientSecret: proposer.clientSecret,
      retry: false,
    });
  });
  afterAll(async () => {
    try {
      if (agent && taskIds.length)
        await agent.tasks.deleteMany(
          { ids: taskIds },
          { teamId: proposer.personalTeamId },
        );
    } finally {
      await harness?.teardown();
    }
  });

  function args() {
    return {
      key: `sdlc-e2e:${randomUUID()}`,
      round: 1,
      deadline: Number.MAX_SAFE_INTEGER,
      revision: {
        base: 'base',
        head: 'head',
        policyDigest: 'policy',
        briefDigest: 'brief',
      },
      reasons: ['check:test'],
    };
  }
  function adapter(
    canDispatch: () => Promise<boolean>,
    loseAcknowledgement = false,
  ) {
    return createMoltNetRepairAdapter({
      teamId: proposer.personalTeamId,
      proposerAgentId: proposer.agentId,
      tasks: {
        ...agent.tasks,
        async create(body, options) {
          const task = await agent.tasks.create(body, options);
          if (!taskIds.includes(task.id)) taskIds.push(task.id);
          if (loseAcknowledgement) {
            loseAcknowledgement = false;
            throw new Error('simulated lost acknowledgement');
          }
          return task;
        },
      },
      body: () => ({
        taskType: 'fulfill_brief',
        diaryId: proposer.privateDiaryId,
        maxAttempts: 1,
        input: { brief: 'Local SDLC protocol test. No repository mutation.' },
      }),
      canDispatch,
      verifyOutput: (output) =>
        output['summary'] === 'Verified local protocol test',
    });
  }

  it('recovers the same task after a lost acknowledgement and a changed admission state', async () => {
    let allowed = true;
    const repair = adapter(() => Promise.resolve(allowed), true);
    const operation = args();
    await expect(repair.startRepair(operation)).rejects.toThrow(
      'lost acknowledgement',
    );
    allowed = false;
    const receipt = await repair.startRepair(operation);
    if (!receipt) throw new Error('Expected a recovered task');
    expect(receipt.taskId).toBe(taskIds.at(-1));
    const task = await agent.tasks.get(receipt.taskId, {
      teamId: proposer.personalTeamId,
    });
    const listed = await agent.tasks.list(
      {
        correlationId: task.correlationId ?? undefined,
        proposedByAgentId: proposer.agentId,
      },
      { teamId: proposer.personalTeamId },
    );
    expect(listed.items.map((item) => item.id)).toEqual([receipt.taskId]);
    await repair.cancelRepair(receipt, 'stop');
    await repair.cancelRepair(receipt, 'stop');
    expect(await repair.repairState(receipt)).toBe('failed');
  });

  it('accepts only the service-selected completed attempt and validated output', async () => {
    const repair = adapter(() => Promise.resolve(true));
    const receipt = await repair.startRepair(args());
    if (!receipt) throw new Error('Expected a dispatched task');
    const options = { teamId: proposer.personalTeamId };
    const claimed = await agent.tasks.claim(receipt.taskId, {}, options);
    expect(await repair.repairState(receipt)).toBe('pending');
    await agent.tasks.heartbeat(
      receipt.taskId,
      claimed.attempt.attemptN,
      {},
      options,
    );
    const output = {
      branch: 'test/sdlc-protocol',
      commits: [],
      pullRequestUrl: null,
      diaryEntryIds: [],
      summary: 'Verified local protocol test',
      verification: {
        inputCid: claimed.task.inputCid,
        passed: true,
        results: [
          {
            id: 'submit-output',
            kind: 'gate',
            status: 'pass',
            detail: 'Submitted by the protocol fixture',
          },
        ],
      },
    };
    await agent.tasks.complete(
      receipt.taskId,
      claimed.attempt.attemptN,
      {
        output,
        outputCid: await computeJsonCid(output),
        usage: { inputTokens: 0, outputTokens: 0 },
      },
      options,
    );
    await pollUntil(
      () => repair.repairState(receipt),
      (state) => state === 'accepted',
      { label: 'sdlc.accepted', maxAttempts: 40, intervalMs: 250 },
    );
    await repair.cancelRepair(receipt, 'already-complete');
    expect(await repair.repairState(receipt)).toBe('accepted');
  });
  it('runs independently registered delivery through real Absurd and MoltNet, projecting a verified draft into GitHub', async () => {
    const queueName = `sdlc-delivery-${randomUUID()}`;
    const profile = await agent.runtimeProfiles.create(
      {
        name: queueName,
        models: {
          generation: { provider: 'Anthropic', model: 'Claude-Sonnet-4-5' },
        },
        sandbox: {},
        runtimeKind: 'gondolin_pi',
      },
      { teamId: proposer.personalTeamId },
    );
    const executorManifest = buildE2EExecutorManifest(profile, 'sdlc');
    const executorFingerprint = computeExecutorManifestCid(executorManifest);
    await agent.tasks.registerExecutorManifest({
      executorManifest,
      executorFingerprint,
      executorSignature: await signExecutorAttestation(
        buildExecutorRegistrationAttestationPayload({ executorFingerprint }),
        proposer.keyPair.privateKey,
      ),
    });
    const correlationId = randomUUID();
    const executor = {
      profileId: profile.id,
      maxAttempts: 1,
      dispatchTimeoutSec: 60,
      runningTimeoutSec: 60,
    };
    const authoring: Parameters<typeof prepareBrief>[0] = {
      workItem: { provider: 'github', repository: 'example/repo', key: '1' },
      policyDigest: 'policy',
      teamId: proposer.personalTeamId,
      diaryId: proposer.privateDiaryId,
      correlationId,
      delivery: executor,
      assessment: executor,
      brief: {
        brief: 'Local protocol fixture, no repository writes.',
        successCriteria: buildRubricSuccessCriteria({
          rubricId: 'protocol',
          criteria: [
            {
              id: 'example',
              description: 'Fixture contract is satisfied',
              weight: 1,
            },
          ],
        }),
      },
    };
    const brief = prepareBrief(authoring);
    const labels = {
      stages: { preparation: 'stage:approval', delivered: 'stage:convergence' },
    };
    const head = 'a'.repeat(40);
    let draft = true;
    let readyMutations = 0;
    const issue = {
      state: 'open',
      title: 'Protocol fixture',
      body: 'Acceptance criteria',
      labels: ['ready', 'approved'],
    };
    const comments: {
      id: number;
      body: string;
      user: { id: number };
      updated_at: string;
    }[] = [];
    // GitHub is the only simulated provider in this test. Task auth, claims,
    // accepted output, and durable workflow storage use the actual services.
    const request: GithubRequest = (path, method, payload) => {
      if (method === 'POST' && path.endsWith('/labels')) {
        issue.labels.push(...(payload as { labels: string[] }).labels);
        return Promise.resolve({});
      }
      if (method === 'POST' && path.endsWith('/comments')) {
        const comment = {
          id: 1,
          body: (payload as { body: string }).body,
          user: { id: 42 },
          updated_at: '2026-10-29T10:00:00Z',
        };
        comments.push(comment);
        return Promise.resolve(comment);
      }
      if (method === 'PATCH' && path.includes('/issues/comments/')) {
        const comment = comments[0];
        comment.body = (payload as { body: string }).body;
        comment.updated_at = '2026-10-29T10:02:00Z';
        return Promise.resolve(comment);
      }
      if (method === 'DELETE' && path.includes('/labels/')) {
        issue.labels = issue.labels.filter(
          (value) => value !== decodeURIComponent(path.split('/').at(-1) ?? ''),
        );
        return Promise.resolve({});
      }
      if (
        method === 'POST' &&
        path === '/graphql' &&
        (payload as { query: string }).query.includes(
          'markPullRequestReadyForReview',
        )
      ) {
        draft = false;
        readyMutations += 1;
        return Promise.reject(
          new Error('Lost ready-for-review acknowledgement'),
        );
      }
      if (method === 'POST' && path === '/graphql')
        return Promise.resolve({
          data: {
            repository: {
              pullRequest: {
                state: 'OPEN',
                headRefOid: head,
                baseRefOid: 'b'.repeat(40),
                reviewThreads: {
                  nodes: [],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        });
      if (path.endsWith('/check-suites/3'))
        return Promise.resolve({ id: 3, head_sha: head, app: { id: 4 } });
      if (path.includes('/check-suites/3/check-runs?'))
        return Promise.resolve({
          total_count: 1,
          check_runs: [
            {
              id: 5,
              name: 'CI',
              app: { id: 4 },
              check_suite: { id: 3 },
              head_sha: head,
              status: 'completed',
              conclusion: 'success',
            },
          ],
        });
      if (method !== 'GET')
        throw new Error(`Unexpected mutation ${method} ${path}`);
      if (path.includes('/comments?')) return Promise.resolve(comments);
      if (path.includes('/events?'))
        return Promise.resolve([
          {
            id: 7,
            event: 'labeled',
            label: { name: 'approved' },
            created_at: '2026-10-29T10:01:00Z',
            actor: { id: 10, login: 'maintainer' },
          },
        ]);
      if (path.endsWith('/permission'))
        return Promise.resolve({ permission: 'admin', user: { id: 10 } });
      if (path.includes('/files?'))
        return Promise.resolve([
          { filename: 'docs/example.md', status: 'modified' },
        ]);
      if (path.endsWith('/pulls/2'))
        return Promise.resolve({
          state: 'open',
          draft,
          node_id: 'pr-node',
          merged: false,
          changed_files: 1,
          head: {
            sha: head,
            ref: 'agent/example',
            repo: { full_name: 'example/repo' },
          },
          base: {
            sha: 'b'.repeat(40),
            ref: 'main',
            repo: { full_name: 'example/repo' },
          },
        });
      return Promise.resolve(issue);
    };
    const app = createGithubMoltNetDeliveryApp({
      databaseUrl: ABSURD_URL,
      queueName,
      agent,
      request,
    });
    let worker: Awaited<ReturnType<typeof app.startWorker>> | undefined;
    try {
      const prepareQueue = `sdlc-prepare-${randomUUID()}`;
      const prepareApp = createGithubPreparationApp({
        databaseUrl: ABSURD_URL,
        queueName: prepareQueue,
        request,
      });
      let prepareWorker:
        | Awaited<ReturnType<typeof prepareApp.startWorker>>
        | undefined;
      let presentation: BriefPresentation;
      try {
        await prepareApp.createQueue(prepareQueue);
        const prepared = await prepareApp.spawn(
          SDLC_PREPARATION_TASK,
          {
            authoring,
            issueDigest: issueDigest(issue),
            github: {
              repository: 'example/repo',
              issueNumber: 1,
              appUserId: 42,
              approvalLabel: 'approved',
              stage: 'preparation',
              labels,
              stopLabels: ['paused', 'cancelled'],
            },
          },
          { queue: prepareQueue },
        );
        prepareWorker = await prepareApp.startWorker({
          concurrency: 1,
          pollInterval: 0.05,
        });
        const completed = await prepareApp.awaitTaskResult(prepared.taskID, {
          timeout: 30,
        });
        if (completed.state !== 'completed')
          throw new Error('Preparation failed');
        const preparedResult = completed.result as unknown as {
          brief: { digest: string };
          presentation: BriefPresentation;
        };
        expect(preparedResult.brief.digest).toBe(brief.digest);
        presentation = preparedResult.presentation;
        expect(presentation).toMatchObject({
          briefDigest: brief.digest,
          commentId: 1,
          presentedAt: '2026-10-29T10:00:00Z',
        });
      } finally {
        await prepareWorker?.close();
        await prepareApp.dropQueue(prepareQueue);
        await prepareApp.close();
      }
      await app.createQueue(queueName);
      const github: GithubDeliveryInput['github'] = {
        repository: 'example/repo',
        issueNumber: 1,
        appUserId: 42,
        presentation,
        policy: {
          eligibleLabels: ['ready'],
          approvalLabel: 'approved',
          pauseLabel: 'paused',
          cancelLabel: 'cancelled',
          allowedPermissions: ['admin'],
          baseBranch: 'main',
          allowedPaths: ['docs/'],
          protectedPaths: [],
          labels,
          deliveredStage: 'delivered',
        },
      };
      const spawned = await app.spawn(
        SDLC_DELIVERY_TASK,
        {
          brief,
          timeoutSec: 30,
          pollIntervalSec: 1,
          github,
        },
        { queue: queueName, idempotencyKey: `delivery:${correlationId}` },
      );
      worker = await app.startWorker({ concurrency: 1, pollInterval: 0.05 });
      const options = { teamId: proposer.personalTeamId };
      const listed = await pollUntil(
        () => agent.tasks.list({ correlationId }, options),
        (value) => value.items.length === 1,
        { label: 'sdlc.dispatch', maxAttempts: 60, intervalMs: 250 },
      );
      const task = listed.items[0];
      taskIds.push(task.id);
      const claim = await agent.tasks.claim(
        task.id,
        { profileId: profile.id, executorFingerprint },
        options,
      );
      await agent.tasks.heartbeat(task.id, claim.attempt.attemptN, {}, options);
      const output = {
        branch: 'agent/example',
        commits: [{ sha: head, message: 'docs: fixture', diaryEntryId: null }],
        pullRequestUrl: 'https://github.com/example/repo/pull/2',
        diaryEntryIds: [],
        summary: 'Protocol fixture',
        verification: {
          inputCid: task.inputCid,
          passed: true,
          results: [
            { id: 'submit-output', kind: 'gate', status: 'pass' },
            { id: 'example', kind: 'rubric', status: 'pass' },
          ],
        },
      };
      const outputCid = await computeJsonCid(output);
      await agent.tasks.complete(
        task.id,
        claim.attempt.attemptN,
        {
          output,
          outputCid,
          executorManifest,
          executorFingerprint,
          executorSignature: await signExecutorAttestation(
            buildExecutorCompleteAttestationPayload({
              taskId: task.id,
              attemptN: claim.attempt.attemptN,
              outputCid,
              executorFingerprint,
            }),
            proposer.keyPair.privateKey,
          ),
          usage: { inputTokens: 0, outputTokens: 0 },
        },
        options,
      );
      const result = await app.awaitTaskResult(spawned.taskID, { timeout: 30 });
      if (result.state !== 'completed')
        throw new Error(`Delivery failed: ${JSON.stringify(result)}`);
      expect(result.result).toMatchObject({
        status: 'delivered',
        published: true,
        handoff: { acceptedWork: { taskId: task.id }, generation: '7' },
      });
      expect(comments).toHaveLength(1);
      expect(issue.labels).toContain('stage:convergence');
      const handoff = (result.result as unknown as { handoff: Handoff })
        .handoff;
      const independent = await createAgent({
        baseUrl: harness.baseUrl,
        db: harness.db,
        bootstrapIdentityId: harness.bootstrapIdentityId,
      });
      const independentSdk = await connect({
        apiUrl: harness.baseUrl,
        clientId: independent.clientId,
        clientSecret: independent.clientSecret,
        retry: false,
      });
      for (const useIndependentAgent of [false, true]) {
        const judgmentQueue = `sdlc-assessment-${randomUUID()}`;
        const assessmentApp = createGithubMoltNetAssessmentApp({
          databaseUrl: ABSURD_URL,
          queueName: judgmentQueue,
          agent,
          request,
        });
        let assessmentWorker:
          | Awaited<ReturnType<typeof assessmentApp.startWorker>>
          | undefined;
        try {
          await assessmentApp.createQueue(judgmentQueue);
          const assessmentRun = await assessmentApp.spawn(
            SDLC_ASSESSMENT_TASK,
            {
              brief,
              delivery: handoff,
              timeoutSec: 30,
              pollIntervalSec: 1,
              github,
            },
            { queue: judgmentQueue },
          );
          assessmentWorker = await assessmentApp.startWorker({
            concurrency: 1,
            pollInterval: 0.05,
          });
          const queued = await pollUntil(
            () =>
              agent.tasks.list(
                { correlationId, taskTypes: ['assess_brief'] },
                options,
              ),
            (value) => value.items.some((item) => !taskIds.includes(item.id)),
            {
              label: 'sdlc.assessment-dispatch',
              maxAttempts: 60,
              intervalMs: 250,
            },
          );
          const assessmentTask = queued.items.find(
            (item) => !taskIds.includes(item.id),
          );
          if (!assessmentTask) throw new Error('Missing assessment task');
          taskIds.push(assessmentTask.id);
          const actor = useIndependentAgent ? independent : proposer;
          const actorSdk = useIndependentAgent ? independentSdk : agent;
          if (useIndependentAgent)
            await agent.taskGrants.create(
              assessmentTask.id,
              {
                subjectId: independent.agentId,
                subjectNs: 'Agent',
                role: 'writer',
              },
              options,
            );
          await actorSdk.tasks.registerExecutorManifest({
            executorManifest,
            executorFingerprint,
            executorSignature: await signExecutorAttestation(
              buildExecutorRegistrationAttestationPayload({
                executorFingerprint,
              }),
              actor.keyPair.privateKey,
            ),
          });
          const judgeClaim = await actorSdk.tasks.claim(
            assessmentTask.id,
            { profileId: profile.id, executorFingerprint },
            options,
          );
          await actorSdk.tasks.heartbeat(
            assessmentTask.id,
            judgeClaim.attempt.attemptN,
            {},
            options,
          );
          const judgment = {
            scores: [
              {
                criterionId: 'example',
                score: 1,
                rationale: 'Protocol fixture meets the criterion',
              },
            ],
            composite: 1,
            verdict: 'Pass',
          };
          const judgmentCid = await computeJsonCid(judgment);
          await actorSdk.tasks.complete(
            assessmentTask.id,
            judgeClaim.attempt.attemptN,
            {
              output: judgment,
              outputCid: judgmentCid,
              executorManifest,
              executorFingerprint,
              executorSignature: await signExecutorAttestation(
                buildExecutorCompleteAttestationPayload({
                  taskId: assessmentTask.id,
                  attemptN: judgeClaim.attempt.attemptN,
                  outputCid: judgmentCid,
                  executorFingerprint,
                }),
                actor.keyPair.privateKey,
              ),
              usage: { inputTokens: 0, outputTokens: 0 },
            },
            options,
          );
          const assessmentResult = await assessmentApp.awaitTaskResult(
            assessmentRun.taskID,
            { timeout: 30 },
          );
          expect(assessmentResult).toMatchObject({
            state: 'completed',
            result: {
              evidence: {
                status: useIndependentAgent ? 'passed' : 'incomplete',
                revision: handoff.revision,
              },
              ...(useIndependentAgent
                ? {}
                : { reason: 'assessment:not-independent' }),
            },
          });
          expect(
            await startReviewExperiment(agent, request, {
              brief,
              delivery: handoff,
              github,
              assessment: {
                taskId: assessmentTask.id,
                attempt: judgeClaim.attempt.attemptN,
                outputCid: judgmentCid,
              },
            }),
          ).toEqual({
            started: useIndependentAgent,
            published: useIndependentAgent,
          });
          expect(readyMutations).toBe(useIndependentAgent ? 1 : 0);
          if (useIndependentAgent) {
            if (assessmentResult.state !== 'completed')
              throw new Error('Assessment incomplete');
            const convergence = await convergeWithProviderEvidence(
              request,
              handoff,
              assessmentResult.result as unknown as AssessmentResult,
            );
            await recordOutcomeExperiment(
              agent,
              proposer,
              handoff,
              convergence,
            );
            issue.labels.push('paused');
            const stopped = await assessmentApp.spawn(
              SDLC_ASSESSMENT_TASK,
              {
                brief,
                delivery: handoff,
                timeoutSec: 30,
                pollIntervalSec: 1,
                github,
              },
              { queue: judgmentQueue },
            );
            expect(
              await assessmentApp.awaitTaskResult(stopped.taskID, {
                timeout: 30,
              }),
            ).toMatchObject({
              state: 'completed',
              result: {
                reason: 'assessment:not-dispatched',
                evidence: { status: 'incomplete' },
              },
            });
            const afterPause = await agent.tasks.list(
              { correlationId, taskTypes: ['assess_brief'] },
              options,
            );
            expect(
              afterPause.items.every((item) => taskIds.includes(item.id)),
            ).toBe(true);
          }
        } finally {
          await assessmentWorker?.close();
          await assessmentApp.dropQueue(judgmentQueue);
          await assessmentApp.close();
        }
      }
    } finally {
      await worker?.close();
      await app.dropQueue(queueName);
      await app.close();
      await agent.runtimeProfiles.delete(profile.id);
    }
  }, 60_000);
});

async function convergeWithProviderEvidence(
  request: GithubRequest,
  handoff: Handoff,
  assessment: AssessmentResult,
) {
  const revision = handoff.revision;
  let reportHasFinding = false;
  const observe = createGithubEvidenceObserver({
    request,
    repository: 'example/repo',
    pr: 2,
    policy: {
      requiredChecks: ['ci'],
      requiredLanes: ['tests'],
      auditLanes: [],
    },
    current: () => Promise.resolve({ revision, control: 'active' }),
    assessment: () => Promise.resolve(assessment.evidence),
    ciBindings: () =>
      Promise.resolve([
        {
          revision,
          repository: 'example/repo',
          suiteId: 3,
          appId: 4,
          checks: { ci: 'CI' },
        },
      ]),
    reviews: () =>
      Promise.resolve([
        {
          binding: {
            revision,
            repository: 'example/repo',
            pr: 2,
            correlationId: handoff.correlationId,
            reviewPolicyDigest: 'review-policy',
            runtimeSha: 'runtime',
          },
          report: {
            version: 1,
            mode: 'active',
            repo: 'example/repo',
            pr: 2,
            base: revision.base,
            head: revision.head,
            correlationId: handoff.correlationId,
            policyDigest: 'review-policy',
            runtimeSha: 'runtime',
            referenceDigests: {},
            packetCount: 1,
            taskIds: [],
            gaps: [],
            durationMs: 1,
            routing: {
              classifierFailed: false,
              scores: { 'code-complexity': 1, 'review-effort': 1 },
              routes: [],
            },
            results: [
              {
                lane: 'tests',
                status: 'clear',
                summary: 'Fixture',
                taskIds: [],
                findings: [],
                privateFindingIds: reportHasFinding
                  ? ['unverified-problem']
                  : [],
              },
            ],
          },
        },
      ]),
  });
  const queueName = `sdlc-convergence-${randomUUID()}`;
  const app = createConvergenceApp({
    databaseUrl: ABSURD_URL,
    queueName,
    port: () => ({
      observe,
      startRepair: () => Promise.reject(new Error('Unexpected repair')),
      repairState: () => Promise.reject(new Error('Unexpected repair poll')),
      cancelRepair: () =>
        Promise.reject(new Error('Unexpected repair cancellation')),
      publish: () => Promise.resolve(true),
    }),
  });
  let worker: Awaited<ReturnType<typeof app.startWorker>> | undefined;
  try {
    await app.createQueue(queueName);
    const run = await app.spawn(
      SDLC_CONVERGENCE_TASK,
      {
        changeKey: 'example/repo:2',
        policy: {
          maxRepairRounds: 2,
          pollIntervalSec: 1,
          evidenceTimeoutSec: 10,
          repairTimeoutSec: 10,
        },
      },
      { queue: queueName },
    );
    worker = await app.startWorker({ concurrency: 1, pollInterval: 0.05 });
    expect(
      await app.awaitTaskResult(run.taskID, { timeout: 20 }),
    ).toMatchObject({
      state: 'completed',
      result: { verdict: { status: 'ready' }, repairs: [] },
    });
    reportHasFinding = true;
    const unsettled = await app.spawn(
      SDLC_CONVERGENCE_TASK,
      {
        changeKey: 'example/repo:2',
        policy: {
          maxRepairRounds: 0,
          pollIntervalSec: 1,
          evidenceTimeoutSec: 10,
          repairTimeoutSec: 10,
        },
      },
      { queue: queueName },
    );
    const result = await app.awaitTaskResult(unsettled.taskID, { timeout: 20 });
    expect(result).toMatchObject({
      state: 'completed',
      result: {
        verdict: { status: 'needs-human' },
        repairs: [],
        findings: [{ id: 'unverified-problem', disposition: 'open' }],
      },
    });
    if (result.state !== 'completed') throw new Error('Convergence incomplete');
    return result.result as unknown as ConvergenceResult;
  } finally {
    await worker?.close();
    await app.dropQueue(queueName);
    await app.close();
  }
}

async function recordOutcomeExperiment(
  agent: Agent,
  proposer: TestAgent,
  handoff: Handoff,
  convergence: ConvergenceResult,
) {
  const queueName = `sdlc-outcome-${randomUUID()}`;
  const observation: OutcomeInput['observation'] = {
    state: 'merged',
    occurredAt: '2026-10-29T10:30:00Z',
    providerUrl: 'https://github.com/example/repo/pull/2',
    mergeCommit: 'merged-sha',
  };
  const create = agent.entries.create.bind(agent.entries);
  let writes = 0;
  let signatures = 0;
  const spy = vi
    .spyOn(agent.entries, 'create')
    .mockImplementation(async (diaryId, body) => {
      const entry = await create(diaryId, body);
      writes += 1;
      if (writes === 1) throw new Error('Lost signed entry acknowledgement');
      return entry;
    });
  const app = createGithubMoltNetOutcomeApp({
    databaseUrl: ABSURD_URL,
    queueName,
    agent,
    request: () =>
      Promise.resolve({
        state: 'closed',
        head: { sha: handoff.revision.head },
        closed_at: observation.occurredAt,
        merged: true,
        merge_commit_sha: observation.mergeCommit,
      }),
    signer: {
      async signDiaryEntry({ signingRequestId }) {
        const request =
          await agent.crypto.signingRequests.get(signingRequestId);
        await agent.crypto.signingRequests.submit(signingRequestId, {
          signature: await cryptoService.signWithNonce(
            request.message,
            request.nonce,
            proposer.keyPair.privateKey,
          ),
        });
        signatures += 1;
        if (signatures === 1) throw new Error('Lost signer acknowledgement');
        return { signingRequestId };
      },
    },
  });
  let worker: Awaited<ReturnType<typeof app.startWorker>> | undefined;
  try {
    await app.createQueue(queueName);
    const run = await app.spawn(
      SDLC_OUTCOME_TASK,
      {
        diaryId: proposer.privateDiaryId,
        teamId: proposer.personalTeamId,
        handoff,
        observation,
        findings: convergence.findings,
      },
      {
        queue: queueName,
        idempotencyKey: `outcome:${handoff.correlationId}`,
      },
    );
    worker = await app.startWorker({ concurrency: 1, pollInterval: 0.05 });
    const result = await app.awaitTaskResult(run.taskID, { timeout: 20 });
    expect(result).toMatchObject({
      state: 'completed',
      result: { recorded: true },
    });
    const entries = await agent.entries.list(proposer.privateDiaryId, {
      tags: ['sdlc:outcome'],
    });
    expect(entries.items).toHaveLength(1);
    expect(entries.items[0].content).toContain('"verifiedForRevision": false');
    expect(entries.items[0].content).toContain('"disposition": "open"');
    expect((await agent.entries.verify(entries.items[0].id)).valid).toBe(true);
    expect(writes).toBe(1);
    expect(signatures).toBe(1);
    expect(await app.awaitTaskResult(run.taskID, { timeout: 20 })).toEqual(
      result,
    );
    expect(writes).toBe(1);
    expect(signatures).toBe(1);
  } finally {
    spy.mockRestore();
    await worker?.close();
    await app.dropQueue(queueName);
    await app.close();
  }
}

async function startReviewExperiment(
  agent: Agent,
  request: GithubRequest,
  input: GithubReviewStartInput,
) {
  const queueName = `sdlc-review-start-${randomUUID()}`;
  const app = createGithubMoltNetReviewStartApp({
    databaseUrl: ABSURD_URL,
    queueName,
    agent,
    request,
  });
  let worker: Awaited<ReturnType<typeof app.startWorker>> | undefined;
  try {
    await app.createQueue(queueName);
    const run = await app.spawn(SDLC_REVIEW_START_TASK, input, {
      queue: queueName,
    });
    worker = await app.startWorker({ concurrency: 1, pollInterval: 0.05 });
    const result = await app.awaitTaskResult(run.taskID, { timeout: 20 });
    if (result.state !== 'completed')
      throw new Error(`Review start failed: ${JSON.stringify(result)}`);
    return result.result;
  } finally {
    await worker?.close();
    await app.dropQueue(queueName);
    await app.close();
  }
}
