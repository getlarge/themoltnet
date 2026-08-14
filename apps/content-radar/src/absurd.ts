import { createOrchestrationAbsurdApp } from '@themoltnet/tasks-orchestrator';
import type { Absurd } from 'absurd-sdk';

import type {
  ContentRadarDeps,
  ContentRadarDurableOutput,
  ContentRadarInput,
  ContentRadarOutput,
} from './types.js';
import { runContentRadar } from './workflow.js';

export const CONTENT_RADAR_QUEUE = 'content-radar';
export const CONTENT_RADAR_TASK = 'content_radar';

/**
 * Strip agent-produced bodies before Absurd persists the workflow result.
 *
 * Signal bodies, the track plan, and dossier prose stay in MoltNet as accepted
 * task outputs and immutable artifacts. Copying them into the workflow store
 * would duplicate the record and let the two drift; the references kept here
 * are enough to hydrate any of it on demand.
 */
export function durableContentRadarOutput(
  output: ContentRadarOutput,
): ContentRadarDurableOutput {
  return {
    correlationId: output.correlationId,
    outcome: output.outcome,
    phaseOutputs: output.phaseOutputs,
    diagnostics: output.diagnostics,
  };
}

export interface ContentRadarAbsurdArgs {
  databaseUrl: string;
  queueName?: string;
  deps: ContentRadarDeps;
}

export function createContentRadarAbsurdApp(
  args: ContentRadarAbsurdArgs,
): Absurd {
  return createOrchestrationAbsurdApp<ContentRadarInput>({
    databaseUrl: args.databaseUrl,
    queueName: args.queueName ?? CONTENT_RADAR_QUEUE,
    taskName: CONTENT_RADAR_TASK,
    defaultMaxAttempts: 3,
    run: async (params, ctx) =>
      durableContentRadarOutput(await runContentRadar(params, ctx, args.deps)),
  });
}
