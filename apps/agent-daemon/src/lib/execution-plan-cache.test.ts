import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Task } from '@moltnet/tasks';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createExecutionPlanCache,
  ProducerContextResolutionError,
  type ResolvedRuntimeSlotContext,
  type RuntimeSlotStore,
} from './execution-plan-cache.js';

const TEAM_ID = '99999999-9999-4999-8999-999999999999';
const PROFILE_ID = 'dddddddd-0000-4000-8000-000000000004';
const SLOT_TTL_MS = 300_000;

type BeginSlotInput = Parameters<RuntimeSlotStore['beginSlot']>[0];

class InMemoryRuntimeSlotStore implements RuntimeSlotStore {
  private readonly slotsByAttempt = new Map<
    string,
    ResolvedRuntimeSlotContext
  >();

  async beginSlot(input: BeginSlotInput): Promise<void> {
    this.slotsByAttempt.set(
      attemptKey(input.teamId, input.lastTaskId, input.lastAttemptN),
      {
        slot: {
          expiresAtMs: Date.now() + SLOT_TTL_MS,
        },
        session: input.sessionDir
          ? {
              sessionDir: input.sessionDir,
              sessionPath: input.sessionPath,
            }
          : null,
        workspace:
          input.workspaceId && input.worktreePath
            ? {
                kind: input.workspaceKind ?? 'origin',
                workspaceId: input.workspaceId,
                worktreeBranch: input.worktreeBranch,
                worktreePath: input.worktreePath,
              }
            : null,
      },
    );
  }

  async finishSlot(
    teamId: string,
    taskId: string,
    attemptN: number,
    _identity: Parameters<RuntimeSlotStore['finishSlot']>[3],
    _slotKey: string,
    _provider: string,
    _model: string,
    sessionPath: string | null,
  ): Promise<void> {
    const slot = this.slotsByAttempt.get(attemptKey(teamId, taskId, attemptN));
    if (!slot) return;

    slot.slot.expiresAtMs = Date.now() + SLOT_TTL_MS;
    if (slot.session) {
      slot.session.sessionPath = sessionPath;
    }
  }

  async findLatestSlotByTaskAttempt(
    teamId: string,
    taskId: string,
    attemptN: number,
  ): Promise<ResolvedRuntimeSlotContext | null> {
    return (
      this.slotsByAttempt.get(attemptKey(teamId, taskId, attemptN)) ?? null
    );
  }

  async close(): Promise<void> {
    // Test fake has no external resources.
  }
}

function attemptKey(teamId: string, taskId: string, attemptN: number): string {
  return `${teamId}:${taskId}:${attemptN}`;
}

async function finishProducerSlot(
  slotStore: RuntimeSlotStore,
  args: {
    taskId: string;
    identity: Parameters<RuntimeSlotStore['finishSlot']>[3];
    slotKey: string;
    sessionPath: string;
  },
): Promise<void> {
  await slotStore.finishSlot(
    TEAM_ID,
    args.taskId,
    1,
    args.identity,
    args.slotKey,
    'p',
    'm',
    args.sessionPath,
  );
}

describe('createExecutionPlanCache', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('copies producer scratch workspace into a fresh judge scratch workspace and forks its session', async () => {
    const mountRoot = mkdtempSync(join(tmpdir(), 'daemon-exec-plan-'));
    tempRoots.push(mountRoot);
    const stateDirs = {
      rootDir: join(mountRoot, '.moltnet', 'd'),
      piSessionsDir: join(mountRoot, '.moltnet', 'd', 'pi-sessions'),
    };
    mkdirSync(stateDirs.piSessionsDir, { recursive: true });

    const producerSessionDir = join(stateDirs.piSessionsDir, 'producer-slot');
    const producerWorkspace = join(
      mountRoot,
      '.moltnet',
      'd',
      'task-workspaces',
      'task-producer',
    );
    mkdirSync(producerSessionDir, { recursive: true });
    mkdirSync(producerWorkspace, { recursive: true });
    const producerSessionPath = join(producerSessionDir, 'session-a.jsonl');
    writeFileSync(producerSessionPath, '[]\n', 'utf8');

    const slotStore = new InMemoryRuntimeSlotStore();
    await slotStore.beginSlot({
      teamId: TEAM_ID,
      agentName: 'local-eval-943',
      daemonProfileId: PROFILE_ID,
      provider: 'ollama-cloud',
      model: 'qwen3.5',
      slotKey: 'run_eval:correlation:test:variant:baseline',
      taskType: 'run_eval',
      sessionDir: producerSessionDir,
      sessionPath: producerSessionPath,
      workspaceId: 'task-producer',
      worktreePath: producerWorkspace,
      worktreeBranch: null,
      lastTaskId: '11111111-1111-4111-8111-111111111111',
      lastAttemptN: 1,
    });
    await finishProducerSlot(slotStore, {
      taskId: '11111111-1111-4111-8111-111111111111',
      identity: {
        agentName: 'local-eval-943',
        daemonProfileId: PROFILE_ID,
      },
      slotKey: 'run_eval:correlation:test:variant:baseline',
      sessionPath: producerSessionPath,
    });

    const cache = createExecutionPlanCache({
      stateDirs,
      slotIdentity: {
        agentName: 'local-eval-943',
        daemonProfileId: PROFILE_ID,
      },
      warmSessionTtlSec: 300,
      slotRegistry: slotStore,
    });

    const plan = await cache.getOrCreate({
      attemptN: 1,
      task: {
        id: '22222222-2222-4222-8222-222222222222',
        teamId: TEAM_ID,
        taskType: 'judge_eval_attempt',
        correlationId: '33333333-3333-4333-8333-333333333333',
        input: {
          targetTaskId: '11111111-1111-4111-8111-111111111111',
          targetAttemptN: 1,
          successCriteria: {
            version: 1,
            rubric: {
              rubricId: 'dbos-after-commit',
              version: 'v1',
              scope: 'eval',
              criteria: [
                {
                  id: 'c1',
                  description: 'criterion',
                  weight: 1,
                  scoring: 'llm_score',
                },
              ],
            },
          },
        },
      } as unknown as Task,
    });

    expect(plan.workspaceMode).toBe('scratch_mount');
    expect(plan.workspaceSeed).toEqual({
      copyFromPath: producerWorkspace,
      source: 'producer',
    });
    expect(plan.sessionPersistence).toEqual({
      sessionDir: `${stateDirs.piSessionsDir}/judge-22222222-2222-4222-8222-222222222222-attempt-1`,
      forkFromSessionPath: producerSessionPath,
    });
    expect(plan.slotKey).toBeNull();
    expect(plan.workspaceId).toBeNull();

    await slotStore.close();
  });

  it('fails clearly when a judge task cannot resolve producer daemon state', async () => {
    const mountRoot = mkdtempSync(join(tmpdir(), 'daemon-exec-plan-miss-'));
    tempRoots.push(mountRoot);
    const stateDirs = {
      rootDir: join(mountRoot, '.moltnet', 'd'),
      piSessionsDir: join(mountRoot, '.moltnet', 'd', 'pi-sessions'),
    };
    mkdirSync(stateDirs.piSessionsDir, { recursive: true });

    const slotStore = new InMemoryRuntimeSlotStore();
    const cache = createExecutionPlanCache({
      stateDirs,
      slotIdentity: {
        agentName: 'local-eval-943',
        daemonProfileId: PROFILE_ID,
      },
      warmSessionTtlSec: 300,
      slotRegistry: slotStore,
    });

    await expect(
      cache.getOrCreate({
        attemptN: 1,
        task: {
          id: '22222222-2222-4222-8222-222222222222',
          teamId: TEAM_ID,
          taskType: 'judge_eval_attempt',
          correlationId: '33333333-3333-4333-8333-333333333333',
          input: {
            targetTaskId: '11111111-1111-4111-8111-111111111111',
            targetAttemptN: 1,
            successCriteria: { version: 1, rubric: null },
          },
        } as unknown as Task,
      }),
    ).rejects.toThrow(ProducerContextResolutionError);

    await slotStore.close();
  });

  it('attaches runtime-slot context for freeform continuations', async () => {
    const mountRoot = mkdtempSync(join(tmpdir(), 'daemon-exec-plan-cont-'));
    tempRoots.push(mountRoot);
    const stateDirs = {
      rootDir: join(mountRoot, '.moltnet', 'd'),
      piSessionsDir: join(mountRoot, '.moltnet', 'd', 'pi-sessions'),
    };
    mkdirSync(stateDirs.piSessionsDir, { recursive: true });

    const producerSessionDir = join(stateDirs.piSessionsDir, 'producer-slot');
    const producerWorkspace = join(
      mountRoot,
      '.moltnet',
      'd',
      'task-workspaces',
      'task-parent',
    );
    mkdirSync(producerSessionDir, { recursive: true });
    mkdirSync(producerWorkspace, { recursive: true });
    const producerSessionPath = join(producerSessionDir, 'session-1.jsonl');
    writeFileSync(
      producerSessionPath,
      '{"role":"system","content":"seed"}\n',
      'utf8',
    );

    const slotStore = new InMemoryRuntimeSlotStore();
    await slotStore.beginSlot({
      teamId: TEAM_ID,
      agentName: 'a',
      daemonProfileId: PROFILE_ID,
      provider: 'p',
      model: 'm',
      slotKey: 'freeform:correlation:abc',
      taskType: 'freeform',
      sessionDir: producerSessionDir,
      sessionPath: producerSessionPath,
      workspaceId: 'task-parent',
      worktreePath: producerWorkspace,
      worktreeBranch: 'feat/parent',
      lastTaskId: '11111111-1111-4111-8111-111111111111',
      lastAttemptN: 1,
    });
    await finishProducerSlot(slotStore, {
      taskId: '11111111-1111-4111-8111-111111111111',
      identity: { agentName: 'a', daemonProfileId: PROFILE_ID },
      slotKey: 'freeform:correlation:abc',
      sessionPath: producerSessionPath,
    });

    const cache = createExecutionPlanCache({
      stateDirs,
      slotIdentity: { agentName: 'a', daemonProfileId: PROFILE_ID },
      warmSessionTtlSec: 300,
      slotRegistry: slotStore,
    });

    const plan = await cache.getOrCreate({
      attemptN: 1,
      task: {
        id: '22222222-2222-4222-8222-222222222222',
        teamId: TEAM_ID,
        taskType: 'freeform',
        correlationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        input: {
          brief: 'next step',
          continueFrom: {
            taskId: '11111111-1111-4111-8111-111111111111',
            attemptN: 1,
          },
        },
      } as unknown as Task,
    });

    expect(plan.workspaceMode).toBe('dedicated_worktree');
    expect(plan.workspaceId).toBe('task-parent');
    expect(plan.worktreeBranch).toBe('feat/parent');
    expect(plan.sessionPersistence?.forkFromSessionPath).toBe(
      producerSessionPath,
    );
    expect(plan.sessionPersistence?.sessionDir).toBe(
      `${stateDirs.piSessionsDir}/continue-22222222-2222-4222-8222-222222222222-attempt-1`,
    );
    expect(plan.workspaceSeed).toBeUndefined();

    await slotStore.close();
  });

  it('forks onto a new branch from the parent tip for mode=fork', async () => {
    const mountRoot = mkdtempSync(join(tmpdir(), 'daemon-exec-plan-fork-'));
    tempRoots.push(mountRoot);
    const stateDirs = {
      rootDir: join(mountRoot, '.moltnet', 'd'),
      piSessionsDir: join(mountRoot, '.moltnet', 'd', 'pi-sessions'),
    };
    mkdirSync(stateDirs.piSessionsDir, { recursive: true });

    const producerSessionDir = join(stateDirs.piSessionsDir, 'producer-slot');
    const producerWorkspace = join(
      mountRoot,
      '.moltnet',
      'd',
      'task-workspaces',
      'task-parent',
    );
    mkdirSync(producerSessionDir, { recursive: true });
    mkdirSync(producerWorkspace, { recursive: true });
    const producerSessionPath = join(producerSessionDir, 'session-1.jsonl');
    writeFileSync(producerSessionPath, '{"role":"system"}\n', 'utf8');

    const slotStore = new InMemoryRuntimeSlotStore();
    await slotStore.beginSlot({
      teamId: TEAM_ID,
      agentName: 'a',
      daemonProfileId: PROFILE_ID,
      provider: 'p',
      model: 'm',
      slotKey: 'freeform:correlation:abc',
      taskType: 'freeform',
      sessionDir: producerSessionDir,
      sessionPath: producerSessionPath,
      workspaceId: 'task-parent',
      worktreePath: producerWorkspace,
      worktreeBranch: 'feat/parent',
      lastTaskId: '11111111-1111-4111-8111-111111111111',
      lastAttemptN: 1,
    });
    await finishProducerSlot(slotStore, {
      taskId: '11111111-1111-4111-8111-111111111111',
      identity: { agentName: 'a', daemonProfileId: PROFILE_ID },
      slotKey: 'freeform:correlation:abc',
      sessionPath: producerSessionPath,
    });

    const cache = createExecutionPlanCache({
      stateDirs,
      slotIdentity: { agentName: 'a', daemonProfileId: PROFILE_ID },
      warmSessionTtlSec: 300,
      slotRegistry: slotStore,
    });

    const plan = await cache.getOrCreate({
      attemptN: 1,
      task: {
        id: '22222222-2222-4222-8222-222222222222',
        teamId: TEAM_ID,
        taskType: 'freeform',
        correlationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        input: {
          brief: 'diverge',
          continueFrom: {
            taskId: '11111111-1111-4111-8111-111111111111',
            attemptN: 1,
            mode: 'fork',
          },
        },
      } as unknown as Task,
    });

    expect(plan.workspaceMode).toBe('dedicated_worktree');
    // NEW unique workspace + NEW branch derived from the parent, base ref =
    // parent branch so git cuts the fork from the parent tip. Both the
    // workspace id and the branch carry the child task id so two forks of the
    // same parent at attempt 1 do not collide.
    expect(plan.workspaceId).toBe(
      'fork-22222222-2222-4222-8222-222222222222-attempt-1',
    );
    expect(plan.worktreeBranch).toBe('feat/parent-fork-22222222-1');
    expect(plan.worktreeBaseRef).toBe('feat/parent');
    expect(plan.workspaceKind).toBe('fork');
    // Session is still copied; the worktree is branched, not seeded.
    expect(plan.sessionPersistence?.forkFromSessionPath).toBe(
      producerSessionPath,
    );
    expect(plan.workspaceSeed).toBeUndefined();

    await slotStore.close();
  });

  it('throws when freeform continueFrom cannot resolve a producer slot', async () => {
    const mountRoot = mkdtempSync(
      join(tmpdir(), 'daemon-exec-plan-cont-miss-'),
    );
    tempRoots.push(mountRoot);
    const stateDirs = {
      rootDir: join(mountRoot, '.moltnet', 'd'),
      piSessionsDir: join(mountRoot, '.moltnet', 'd', 'pi-sessions'),
    };
    mkdirSync(stateDirs.piSessionsDir, { recursive: true });

    const slotStore = new InMemoryRuntimeSlotStore();
    const cache = createExecutionPlanCache({
      stateDirs,
      slotIdentity: { agentName: 'a', daemonProfileId: PROFILE_ID },
      warmSessionTtlSec: 300,
      slotRegistry: slotStore,
    });

    await expect(
      cache.getOrCreate({
        attemptN: 1,
        task: {
          id: '22222222-2222-4222-8222-222222222222',
          teamId: TEAM_ID,
          taskType: 'freeform',
          correlationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          input: {
            brief: 'next step',
            continueFrom: {
              taskId: '11111111-1111-4111-8111-111111111111',
              attemptN: 1,
            },
          },
        } as unknown as Task,
      }),
    ).rejects.toThrow(ProducerContextResolutionError);

    await slotStore.close();
  });

  it('uses the shared mount root as the judge copy source for shared-mount producers', async () => {
    const mountRoot = mkdtempSync(join(tmpdir(), 'daemon-exec-plan-shared-'));
    tempRoots.push(mountRoot);
    const stateDirs = {
      rootDir: join(mountRoot, '.moltnet', 'd'),
      piSessionsDir: join(mountRoot, '.moltnet', 'd', 'pi-sessions'),
    };
    mkdirSync(stateDirs.piSessionsDir, { recursive: true });

    const producerSessionDir = join(stateDirs.piSessionsDir, 'producer-slot');
    mkdirSync(producerSessionDir, { recursive: true });
    const producerSessionPath = join(producerSessionDir, 'session-a.jsonl');
    writeFileSync(producerSessionPath, '[]\n', 'utf8');

    const slotStore = new InMemoryRuntimeSlotStore();
    await slotStore.beginSlot({
      teamId: TEAM_ID,
      agentName: 'local-eval-943',
      daemonProfileId: PROFILE_ID,
      provider: 'ollama-cloud',
      model: 'qwen3.5',
      slotKey: 'run_eval:correlation:test:variant:baseline',
      taskType: 'run_eval',
      sessionDir: producerSessionDir,
      sessionPath: producerSessionPath,
      workspaceId: null,
      worktreePath: null,
      worktreeBranch: null,
      lastTaskId: '11111111-1111-4111-8111-111111111111',
      lastAttemptN: 1,
    });
    await finishProducerSlot(slotStore, {
      taskId: '11111111-1111-4111-8111-111111111111',
      identity: {
        agentName: 'local-eval-943',
        daemonProfileId: PROFILE_ID,
      },
      slotKey: 'run_eval:correlation:test:variant:baseline',
      sessionPath: producerSessionPath,
    });

    const cache = createExecutionPlanCache({
      stateDirs,
      slotIdentity: {
        agentName: 'local-eval-943',
        daemonProfileId: PROFILE_ID,
      },
      warmSessionTtlSec: 300,
      slotRegistry: slotStore,
    });

    const plan = await cache.getOrCreate({
      attemptN: 1,
      task: {
        id: '22222222-2222-4222-8222-222222222222',
        teamId: TEAM_ID,
        taskType: 'judge_eval_attempt',
        correlationId: '33333333-3333-4333-8333-333333333333',
        input: {
          targetTaskId: '11111111-1111-4111-8111-111111111111',
          targetAttemptN: 1,
          successCriteria: { version: 1, rubric: null },
        },
      } as unknown as Task,
    });

    expect(plan.workspaceSeed).toEqual({
      copyFromPath: mountRoot,
      source: 'producer',
    });

    await slotStore.close();
  });
});
