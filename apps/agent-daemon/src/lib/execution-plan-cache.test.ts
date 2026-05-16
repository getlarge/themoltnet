import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DaemonSlotRegistry } from './daemon-slot-registry.js';
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

  it('attaches judge_eval_attempt to the producer scratch workspace and forks its session', () => {
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
    slotRegistry.beginSlot({
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
    slotRegistry.finishSlot(
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

    const plan = cache.getOrCreate({
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
      },
    });

    expect(plan.workspaceMode).toBe('scratch_mount');
    expect(plan.workspaceAttachment).toEqual({
      mountPath: producerWorkspace,
      cwdPath: producerWorkspace,
      shadowWrites: 'tmpfs',
    });
    expect(plan.sessionPersistence).toEqual({
      sessionDir: `${stateDirs.piSessionsDir}/judge-22222222-2222-4222-8222-222222222222-attempt-1`,
      forkFromSessionPath: producerSessionPath,
    });
    expect(plan.slotKey).toBeNull();
    expect(plan.workspaceId).toBeNull();

    slotRegistry.close();
  });

  it('fails clearly when a judge task cannot resolve producer daemon state', () => {
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

    expect(() =>
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
        },
      }),
    ).toThrow(ProducerContextResolutionError);

    slotRegistry.close();
  });
});
