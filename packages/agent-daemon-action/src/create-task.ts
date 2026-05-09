/**
 * Thin wrappers around the SDK's `agent.tasks.create()` for the two
 * task types the dispatcher creates.
 *
 * Body shapes are enforced at compile time by `CreateTaskData['body']`
 * (generated from the OpenAPI spec via `agent-runtime`'s SDK), so a
 * malformed payload fails the build, not at runtime. The SDK also
 * handles client_credentials auth + token refresh; we never see a
 * bearer token here.
 *
 * **Fulfill** is created when a human writes `@moltnet-fulfill` on an
 * issue. The originating issue URL is embedded in the brief text;
 * `references[]` is left empty.
 *
 * **Assess** is created when a human writes `@moltnet-assess` on a PR
 * that already has a fulfill_brief in the same correlation chain.
 * The rubric is **inherited from the fulfill task's
 * `input.successCriteria`** — no human-supplied rubric, no rubric
 * registry lookup. The chain becomes self-describing: whatever
 * acceptance the imposer pinned on the fulfill task is exactly what
 * the assess task judges against (#1028's producer/judge model).
 */

import type {
  AssessBriefInput,
  SuccessCriteria,
  Task,
  TaskRef,
} from '@moltnet/tasks';
import type { Agent } from '@themoltnet/sdk';

export interface FulfillTaskInput {
  agent: Agent;
  teamId: string;
  diaryId: string;
  correlationId: string;
  /**
   * GitHub issue URL the @moltnet-fulfill mention came from. Inlined
   * into the brief so the agent has it as context; not stored in
   * `task.references`.
   */
  referenceUrl: string;
  title?: string;
  brief: string;
  /**
   * Optional machine-verifiable acceptance envelope. When set, the
   * producer LLM is required to emit `output.verification` per the
   * cross-field rule in #1028. Inherits onto any subsequent
   * assess_brief in the same chain.
   */
  successCriteria?: SuccessCriteria;
  /**
   * Override the imposer-side running-total cap (server default 7200s).
   * Set this to match (or undercut) the workflow's `timeout-minutes`
   * so an aborted runner doesn't leave the queue's view of the task
   * "running" until the default 2h cap fires.
   */
  runningTimeoutSec?: number;
}

export async function createTask(input: FulfillTaskInput): Promise<Task> {
  const briefWithSource = input.brief.includes(input.referenceUrl)
    ? input.brief
    : `${input.brief}\n\nSource: ${input.referenceUrl}`;

  return input.agent.tasks.create({
    taskType: 'fulfill_brief',
    teamId: input.teamId,
    diaryId: input.diaryId,
    input: {
      brief: briefWithSource,
      ...(input.title ? { title: input.title } : {}),
      ...(input.successCriteria
        ? { successCriteria: input.successCriteria }
        : {}),
    },
    correlationId: input.correlationId,
    ...(input.runningTimeoutSec !== undefined
      ? { runningTimeoutSec: input.runningTimeoutSec }
      : {}),
  });
}

export interface AssessTaskInput {
  agent: Agent;
  teamId: string;
  diaryId: string;
  correlationId: string;
  /** The fulfill_brief being judged. */
  targetTaskId: string;
  /** outputCid of the fulfill task's accepted attempt — required by TaskRef. */
  targetOutputCid: string;
  /**
   * Required rubric envelope. The dispatcher copies this from the
   * fulfill task's `input.successCriteria`; if the fulfill carried no
   * criteria the dispatcher posts a "nothing to judge" reply instead
   * of calling this function.
   */
  successCriteria: SuccessCriteria;
  /**
   * Override the imposer-side running-total cap (server default 7200s).
   * Same rationale as FulfillTaskInput.runningTimeoutSec.
   */
  runningTimeoutSec?: number;
}

export async function createAssessTask(input: AssessTaskInput): Promise<Task> {
  const assessInput: AssessBriefInput = {
    targetTaskId: input.targetTaskId,
    successCriteria: input.successCriteria,
  };
  const reference: TaskRef = {
    taskId: input.targetTaskId,
    outputCid: input.targetOutputCid,
    role: 'judged_work',
  };

  return input.agent.tasks.create({
    taskType: 'assess_brief',
    teamId: input.teamId,
    diaryId: input.diaryId,
    input: assessInput,
    references: [reference],
    correlationId: input.correlationId,
    ...(input.runningTimeoutSec !== undefined
      ? { runningTimeoutSec: input.runningTimeoutSec }
      : {}),
  });
}
