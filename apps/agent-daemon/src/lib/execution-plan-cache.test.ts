import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Task } from '@moltnet/tasks';
import { DaemonSlotRegistry } from '@themoltnet/agent-daemon-state';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createExecutionPlanCache,
  ProducerContextResolutionError,
} from './execution-plan-cache.js';

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
      registryDbPath: join(mountRoot, '.moltnet', 'd', 'daemon-state.sqlite'),
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

    const slotRegistry = new DaemonSlotRegistry(stateDirs.registryDbPath);
    await slotRegistry.beginSlot({
      agentName: 'local-eval-943',
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
      ttlSec: 300,
    });
    await slotRegistry.finishSlot(
      {
        agentName: 'local-eval-943',
        provider: 'ollama-cloud',
        model: 'qwen3.5',
      },
      'run_eval:correlation:test:variant:baseline',
      300,
      producerSessionPath,
    );

    const cache = createExecutionPlanCache({
      stateDirs,
      slotIdentity: {
        agentName: 'local-eval-943',
        provider: 'ollama-cloud',
        model: 'qwen3.5',
      },
      warmSessionTtlSec: 300,
      slotRegistry,
    });

    const plan = await cache.getOrCreate({
      attemptN: 1,
      task: {
        id: '22222222-2222-4222-8222-222222222222',
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

    await slotRegistry.close();
  });

  it('fails clearly when a judge task cannot resolve producer daemon state', async () => {
    const mountRoot = mkdtempSync(join(tmpdir(), 'daemon-exec-plan-miss-'));
    tempRoots.push(mountRoot);
    const stateDirs = {
      rootDir: join(mountRoot, '.moltnet', 'd'),
      piSessionsDir: join(mountRoot, '.moltnet', 'd', 'pi-sessions'),
      registryDbPath: join(mountRoot, '.moltnet', 'd', 'daemon-state.sqlite'),
    };
    mkdirSync(stateDirs.piSessionsDir, { recursive: true });

    const slotRegistry = new DaemonSlotRegistry(stateDirs.registryDbPath);
    const cache = createExecutionPlanCache({
      stateDirs,
      slotIdentity: {
        agentName: 'local-eval-943',
        provider: 'ollama-cloud',
        model: 'qwen3.5',
      },
      warmSessionTtlSec: 300,
      slotRegistry,
    });

    await expect(
      cache.getOrCreate({
        attemptN: 1,
        task: {
          id: '22222222-2222-4222-8222-222222222222',
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

    await slotRegistry.close();
  });

  it('attaches warm-slot context for freeform continuations', async () => {
    const mountRoot = mkdtempSync(join(tmpdir(), 'daemon-exec-plan-cont-'));
    tempRoots.push(mountRoot);
    const stateDirs = {
      rootDir: join(mountRoot, '.moltnet', 'd'),
      piSessionsDir: join(mountRoot, '.moltnet', 'd', 'pi-sessions'),
      registryDbPath: join(mountRoot, '.moltnet', 'd', 'daemon-state.sqlite'),
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

    const slotRegistry = new DaemonSlotRegistry(stateDirs.registryDbPath);
    await slotRegistry.beginSlot({
      agentName: 'a',
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
      ttlSec: 300,
    });
    await slotRegistry.finishSlot(
      { agentName: 'a', provider: 'p', model: 'm' },
      'freeform:correlation:abc',
      300,
      producerSessionPath,
    );

    const cache = createExecutionPlanCache({
      stateDirs,
      slotIdentity: { agentName: 'a', provider: 'p', model: 'm' },
      warmSessionTtlSec: 300,
      slotRegistry,
    });

    const plan = await cache.getOrCreate({
      attemptN: 1,
      task: {
        id: '22222222-2222-4222-8222-222222222222',
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

    await slotRegistry.close();
  });

  it('throws when freeform continueFrom cannot resolve a producer slot', async () => {
    const mountRoot = mkdtempSync(
      join(tmpdir(), 'daemon-exec-plan-cont-miss-'),
    );
    tempRoots.push(mountRoot);
    const stateDirs = {
      rootDir: join(mountRoot, '.moltnet', 'd'),
      piSessionsDir: join(mountRoot, '.moltnet', 'd', 'pi-sessions'),
      registryDbPath: join(mountRoot, '.moltnet', 'd', 'daemon-state.sqlite'),
    };
    mkdirSync(stateDirs.piSessionsDir, { recursive: true });

    const slotRegistry = new DaemonSlotRegistry(stateDirs.registryDbPath);
    const cache = createExecutionPlanCache({
      stateDirs,
      slotIdentity: { agentName: 'a', provider: 'p', model: 'm' },
      warmSessionTtlSec: 300,
      slotRegistry,
    });

    await expect(
      cache.getOrCreate({
        attemptN: 1,
        task: {
          id: '22222222-2222-4222-8222-222222222222',
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

    await slotRegistry.close();
  });

  it('uses the shared mount root as the judge copy source for shared-mount producers', async () => {
    const mountRoot = mkdtempSync(join(tmpdir(), 'daemon-exec-plan-shared-'));
    tempRoots.push(mountRoot);
    const stateDirs = {
      rootDir: join(mountRoot, '.moltnet', 'd'),
      piSessionsDir: join(mountRoot, '.moltnet', 'd', 'pi-sessions'),
      registryDbPath: join(mountRoot, '.moltnet', 'd', 'daemon-state.sqlite'),
    };
    mkdirSync(stateDirs.piSessionsDir, { recursive: true });

    const producerSessionDir = join(stateDirs.piSessionsDir, 'producer-slot');
    mkdirSync(producerSessionDir, { recursive: true });
    const producerSessionPath = join(producerSessionDir, 'session-a.jsonl');
    writeFileSync(producerSessionPath, '[]\n', 'utf8');

    const slotRegistry = new DaemonSlotRegistry(stateDirs.registryDbPath);
    await slotRegistry.beginSlot({
      agentName: 'local-eval-943',
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
      ttlSec: 300,
    });
    await slotRegistry.finishSlot(
      {
        agentName: 'local-eval-943',
        provider: 'ollama-cloud',
        model: 'qwen3.5',
      },
      'run_eval:correlation:test:variant:baseline',
      300,
      producerSessionPath,
    );

    const cache = createExecutionPlanCache({
      stateDirs,
      slotIdentity: {
        agentName: 'local-eval-943',
        provider: 'ollama-cloud',
        model: 'qwen3.5',
      },
      warmSessionTtlSec: 300,
      slotRegistry,
    });

    const plan = await cache.getOrCreate({
      attemptN: 1,
      task: {
        id: '22222222-2222-4222-8222-222222222222',
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

    await slotRegistry.close();
  });
});
