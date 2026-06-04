/**
 * Resolve the source-attempt material that backs a freeform
 * `continueFrom` continuation. Called from `executePiTask` before the
 * prompt is built; the result is forwarded to `buildTaskUserPrompt` via
 * `TaskUserPromptContext.priorContext` so the freeform builder can
 * render the "Prior context" section.
 *
 * Failure mode is graceful: any error from the API client (network,
 * 404, malformed output) yields `null` so the prompt still assembles
 * without a Prior context section. Caller logs the failure.
 */
import type { FreeformArtifact, FreeformOutput } from '@moltnet/tasks';
import type { Agent } from '@themoltnet/sdk';

export interface ResolvedPriorContext {
  summary?: string;
  artifacts?: ReadonlyArray<{
    kind: string;
    title: string;
    body?: string;
  }>;
}

export interface ContinueFromPointer {
  taskId: string;
  attemptN: number;
}

/**
 * Fetch the named attempt's output and project it into the prompt's
 * priorContext shape. Returns `null` when the attempt cannot be located
 * or its output is missing/malformed — the prompt builder treats that
 * as "no prior context", which is harmless.
 */
export async function resolvePriorContext(
  agent: Pick<Agent, 'tasks'>,
  continueFrom: ContinueFromPointer,
): Promise<ResolvedPriorContext | null> {
  const attempts = await agent.tasks.listAttempts(continueFrom.taskId);
  const attempt = attempts.find((a) => a.attemptN === continueFrom.attemptN);
  if (!attempt || !attempt.output) return null;
  const output = attempt.output as Partial<FreeformOutput>;
  const summary =
    typeof output.summary === 'string' ? output.summary : undefined;
  const artifacts = Array.isArray(output.artifacts)
    ? (output.artifacts as FreeformArtifact[])
        .filter(
          (a): a is FreeformArtifact =>
            !!a && typeof a.kind === 'string' && typeof a.title === 'string',
        )
        .map((a) => ({
          kind: a.kind,
          title: a.title,
          body: a.body,
        }))
    : undefined;
  if (!summary && (!artifacts || artifacts.length === 0)) return null;
  return { summary, artifacts };
}
