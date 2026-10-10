/**
 * Stage-1 deterministic gate evaluator. Reads an attempt's message stream and
 * accepted output and asserts the `GateExpectations` — with NO LLM involved.
 *
 * This is the load-bearing anti-"inception" layer: because gates are code, they
 * cannot co-regress with the runtime prompt under test. An attempt that fails
 * any gate is scored composite 0 and never reaches the LLM judge.
 *
 * The evaluator depends only on the narrow `GateAgent` interface below, not the
 * full `@themoltnet/sdk` `Agent`, so it is unit-testable with a fake and the
 * lib carries no runtime SDK dependency. The real `Agent` structurally
 * satisfies `GateAgent`.
 */
import {
  FreeformOutput,
  RunEvalOutput,
  validateOutputContractResult,
} from '@moltnet/tasks';
import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';

import type { GateExpectations, ScenarioTaskType } from './scenario.js';
import { formatTypeBoxErrors } from './typebox-errors.js';

/**
 * Per-producer-task-type facts the gate check needs: which output schema the
 * captured submit must satisfy, and which output field carries the graded
 * response string (`run_eval` submits `response`, `freeform` submits `summary`).
 */
const TASK_TYPE_OUTPUT: Record<
  ScenarioTaskType,
  { schema: TSchema; schemaName: string; responseField: string }
> = {
  run_eval: {
    schema: RunEvalOutput,
    schemaName: 'RunEvalOutput',
    responseField: 'response',
  },
  freeform: {
    schema: FreeformOutput,
    schemaName: 'FreeformOutput',
    responseField: 'summary',
  },
};

/** Minimal shape of a task message (a structural subset of the SDK's
 * `TaskMessage`). */
export interface GateTaskMessage {
  /** Server sequence number; enables paging past the first page. */
  seq?: number;
  kind: string;
  payload: { [key: string]: unknown };
}

/** Minimal shape of a task attempt (a structural subset of `TaskAttempt`). */
export interface GateTaskAttempt {
  attemptN: number;
  status: string;
  output: { [key: string]: unknown } | null;
}

/** Minimal shape of a task artifact (a structural subset of `TaskArtifact`). */
export interface GateTaskArtifact {
  cid: string;
  attemptN: number | null;
  title: string;
}

/** Minimal shape of an artifact download (a structural subset of
 * `TaskArtifactDownload`). */
export interface GateArtifactDownload {
  stream: AsyncIterable<Uint8Array>;
}

/**
 * The narrow slice of the SDK `Agent` that `checkGates` needs. The real
 * `agent.tasks` satisfies this structurally. The `artifacts` slice is only
 * exercised when a scenario sets `forbidArtifactContentMatching`.
 */
export interface GateAgent {
  runtimeSessions?: {
    read(
      storeId: string,
      afterSeq: number,
      options: { teamId: string },
    ): Promise<{
      items: AsyncIterable<{ seq: number; writes: Record<string, unknown>[] }>;
    }>;
  };
  tasks: {
    listMessages(
      taskId: string,
      attemptN: number,
      query?: { afterSeq?: number },
    ): Promise<GateTaskMessage[]>;
    listAttempts(taskId: string): Promise<GateTaskAttempt[]>;
    artifacts: {
      list(
        taskId: string,
        options: { teamId: string },
        query?: unknown,
      ): Promise<GateTaskArtifact[]>;
      download(
        path: { taskId: string; cid: string },
        options: { teamId: string },
      ): Promise<GateArtifactDownload>;
    };
  };
}

/** One failed gate expectation. */
export interface GateFailure {
  /** Stable identifier for the gate that failed. */
  gate: string;
  /** Human-readable reason. */
  detail: string;
}

export interface GateResult {
  passed: boolean;
  failures: GateFailure[];
}

interface ExecuteStartPayload {
  event: 'execute_start';
  model: string;
  provider: string;
  workspaceMode: string;
}

/**
 * Mirror the daemon's `toDaemonWorkspaceMode`: the task-type/eval workspace mode
 * `none` is remapped to `scratch_mount` before the runtime emits it in
 * `execute_start`. Keep this in sync with apps/agent-daemon.
 */
function toDaemonWorkspaceMode(mode: string): string {
  return mode === 'none' ? 'scratch_mount' : mode;
}

function infoEvent(
  messages: GateTaskMessage[],
  event: string,
): { [key: string]: unknown } | undefined {
  return messages.find((m) => m.kind === 'info' && m.payload.event === event)
    ?.payload;
}

function toolNames(messages: GateTaskMessage[]): Set<string> {
  const names = new Set<string>();
  for (const m of messages) {
    if (m.kind === 'tool_call_start') {
      const name = m.payload.tool_name;
      if (typeof name === 'string') {
        names.add(name);
      }
    }
  }
  return names;
}

/** Read every message of an attempt. The API caps a page, and text deltas are
 * stored one row per chunk, so terminal events are often past page one. Stops
 * when a page is empty, lacks `seq`, or makes no progress. */
async function listAllMessages(
  agent: GateAgent,
  taskId: string,
  attemptN: number,
): Promise<GateTaskMessage[]> {
  const messages: GateTaskMessage[] = [];
  let afterSeq: number | undefined;
  for (;;) {
    const page = await agent.tasks.listMessages(
      taskId,
      attemptN,
      afterSeq === undefined ? undefined : { afterSeq },
    );
    const fresh =
      afterSeq === undefined
        ? page
        : page.filter((m) => m.seq !== undefined && m.seq > afterSeq!);
    if (fresh.length === 0) return messages;
    messages.push(...fresh);
    const last = fresh[fresh.length - 1].seq;
    if (last === undefined) return messages;
    afterSeq = last;
  }
}

function finalMessageSubmits(messages: GateTaskMessage[]): {
  captured: boolean;
  invalid: number;
} {
  let captured = false;
  let invalid = 0;
  for (const message of messages) {
    if (
      message.kind !== 'info' ||
      message.payload.event !== 'final_message_submit'
    ) {
      continue;
    }
    if (message.payload.result === 'captured') captured = true;
    if (message.payload.result === 'invalid') invalid += 1;
  }
  return { captured, invalid };
}

function submitCallResults(
  messages: GateTaskMessage[],
  toolName: string,
): { succeeded: number; failed: number; errors: string[] } {
  let succeeded = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const message of messages) {
    if (
      message.kind !== 'tool_call_end' ||
      message.payload.tool_name !== toolName
    ) {
      continue;
    }
    if (message.payload.is_error === true) {
      failed += 1;
      if (Array.isArray(message.payload.result) && errors.length < 3) {
        for (const part of message.payload.result as Array<{
          type?: string;
          text?: string;
        }>) {
          if (errors.length >= 3) break;
          if (part.type === 'text' && typeof part.text === 'string')
            errors.push(part.text.slice(0, 500));
        }
      }
    } else if (message.payload.is_error === false) {
      succeeded += 1;
    }
  }
  return { succeeded, failed, errors };
}

/** Read only the committed entries indexed by this attempt, never a later head. */
async function durableToolEvents(
  agent: GateAgent,
  messages: GateTaskMessage[],
  teamId: string | undefined,
): Promise<GateTaskMessage[]> {
  const events: GateTaskMessage[] = [];
  const commits = new Map<string, Record<string, unknown>[]>();
  const seen = new Set<string>();
  for (const { payload: ref } of messages) {
    if (ref.event !== 'runtime_entry' || ref.format !== 'pi-durable.v1')
      continue;
    if (!agent.runtimeSessions || !teamId)
      throw new Error(
        'Durable gate evidence requires a runtime store reader and team',
      );
    if (
      typeof ref.storeId !== 'string' ||
      typeof ref.commitSeq !== 'number' ||
      typeof ref.entryId !== 'number'
    )
      throw new Error('Invalid Durable entry reference');
    const identity = `${ref.storeId}:${ref.entryId}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const key = `${ref.storeId}:${ref.commitSeq}`;
    let writes = commits.get(key);
    if (!writes) {
      const page = await agent.runtimeSessions.read(
        ref.storeId,
        ref.commitSeq - 1,
        { teamId },
      );
      for await (const commit of page.items) {
        if (commit.seq === ref.commitSeq) {
          writes = commit.writes;
          break;
        }
      }
      if (!writes) throw new Error('Durable evidence commit is unavailable');
      commits.set(key, writes);
    }
    const entry = writes.find(
      (write) =>
        write.type === 'entry' &&
        (write.value as { id?: unknown } | undefined)?.id === ref.entryId,
    )?.value as
      | {
          model?: Array<{
            role?: string;
            toolName?: string;
            isError?: boolean;
            content?: unknown;
          }>;
        }
      | undefined;
    if (!entry) throw new Error('Durable evidence entry is unavailable');
    for (const message of entry.model ?? []) {
      if (message.role === 'assistant' && Array.isArray(message.content)) {
        for (const part of message.content as Array<{
          type?: string;
          name?: string;
        }>) {
          if (part.type === 'toolCall' && typeof part.name === 'string')
            events.push({
              kind: 'tool_call_start',
              payload: { tool_name: part.name },
            });
        }
      } else if (
        message.role === 'toolResult' &&
        typeof message.toolName === 'string'
      ) {
        events.push({
          kind: 'tool_call_end',
          payload: {
            tool_name: message.toolName,
            is_error: message.isError === true,
            result: message.content,
          },
        });
      }
    }
  }
  return events;
}

/** Decode an artifact byte stream to text, capped so a hostile large upload
 * cannot exhaust memory during a content scan. */
async function readStreamText(
  stream: AsyncIterable<Uint8Array>,
  capBytes = 1_000_000,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  for await (const chunk of stream) {
    text += decoder.decode(chunk, { stream: true });
    total += chunk.length;
    if (total >= capBytes) break;
  }
  text += decoder.decode();
  return text;
}

/**
 * Evaluate the deterministic gates for one attempt.
 *
 * @param agent - Narrow agent slice (see `GateAgent`).
 * @param taskId - The producer `run_eval` task id.
 * @param attemptN - The accepted attempt number.
 * @param gates - Scenario gate expectations.
 * @param expected - Expected runtime facts to cross-check against
 *   `execute_start` (the model the profile pinned, and the eval's declared
 *   workspace mode).
 */
export async function checkGates(
  agent: GateAgent,
  taskId: string,
  attemptN: number,
  gates: GateExpectations,
  expected: {
    model: string;
    workspace: string;
    teamId?: string;
    taskType?: ScenarioTaskType;
    outputContract?: { version: 1; schema: Record<string, unknown> };
  },
): Promise<GateResult> {
  const failures: GateFailure[] = [];
  const {
    schema: outputSchema,
    schemaName,
    responseField,
  } = TASK_TYPE_OUTPUT[expected.taskType ?? 'run_eval'];
  const messages = await listAllMessages(agent, taskId, attemptN);
  try {
    messages.push(
      ...(await durableToolEvents(agent, messages, expected.teamId)),
    );
  } catch (error) {
    failures.push({
      gate: 'runtime_evidence',
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  // Gate: a prompt_build_failure short-circuits everything else.
  const buildError = messages.find(
    (m) => m.kind === 'error' && m.payload.phase === 'prompt_build',
  );
  if (buildError) {
    const reason =
      typeof buildError.payload.message === 'string'
        ? buildError.payload.message
        : 'unknown';
    failures.push({
      gate: 'prompt_build',
      detail: `prompt build failed: ${reason}`,
    });
  }

  // Gate: execute_start present with the expected model + workspace mode.
  const start = infoEvent(messages, 'execute_start') as
    | ExecuteStartPayload
    | undefined;
  if (!start) {
    failures.push({
      gate: 'execute_start',
      detail: 'no execute_start event in attempt message stream',
    });
  } else {
    if (start.model !== expected.model) {
      failures.push({
        gate: 'model',
        detail: `execute_start.model=${start.model}, expected ${expected.model}`,
      });
    }
    // The daemon remaps the task-type workspace mode `none` to `scratch_mount`
    // before it reaches `execute_start` (see `toDaemonWorkspaceMode` in
    // apps/agent-daemon). Apply the same mapping to the expectation so a
    // `workspace: none` scenario compares against what the runtime actually
    // reports.
    const wantWorkspace = toDaemonWorkspaceMode(
      gates.expectWorkspaceMode ?? expected.workspace,
    );
    if (start.workspaceMode !== wantWorkspace) {
      failures.push({
        gate: 'workspace_mode',
        detail: `execute_start.workspaceMode=${start.workspaceMode}, expected ${wantWorkspace}`,
      });
    }
  }

  // Gate: prompt_assembled present with all required sections.
  const assembled = infoEvent(messages, 'prompt_assembled');
  if (!assembled) {
    failures.push({
      gate: 'prompt_assembled',
      detail: 'no prompt_assembled event in attempt message stream',
    });
  } else if (gates.requirePromptSections?.length) {
    const sections = Array.isArray(assembled.sections)
      ? (assembled.sections as Array<{ id?: unknown }>)
      : [];
    const present = new Set(
      sections
        .map((s) => (typeof s.id === 'string' ? s.id : undefined))
        .filter((id): id is string => id !== undefined),
    );
    for (const required of gates.requirePromptSections) {
      if (!present.has(required)) {
        failures.push({
          gate: 'prompt_section',
          detail: `required prompt section "${required}" not present`,
        });
      }
    }
  }

  // Gate: required / forbidden tool calls.
  if (gates.requireToolCalls?.length || gates.forbidToolCalls?.length) {
    const called = toolNames(messages);
    for (const tool of gates.requireToolCalls ?? []) {
      if (!called.has(tool)) {
        failures.push({
          gate: 'tool_required',
          detail: `required tool "${tool}" was not called`,
        });
      }
    }
    for (const tool of gates.forbidToolCalls ?? []) {
      if (called.has(tool)) {
        failures.push({
          gate: 'tool_forbidden',
          detail: `forbidden tool "${tool}" was called`,
        });
      }
    }
  }

  // Gate: a clean submit — exactly one accepted payload and no invalid
  // attempts, plus a schema-valid accepted output. Runtime recovery
  // deliberately permits invalid calls inside one session; this eval gate
  // measures whether the model completed the protocol without needing that
  // recovery. A valid JSON-only final message counts as the one accepted
  // payload; scoring gives it partial credit (`submitProtocolCredit`).
  if (gates.requireCleanSubmit ?? true) {
    const submitToolName = `submit_${expected.taskType ?? 'run_eval'}_output`;
    const submitCalls = submitCallResults(messages, submitToolName);
    const finalMessage = finalMessageSubmits(messages);
    if (submitCalls.failed > 0) {
      failures.push({
        gate: 'submit_clean',
        detail: `${submitToolName} had ${submitCalls.failed} invalid call(s)${submitCalls.errors.length ? `: ${submitCalls.errors.join(' | ')}` : ''}`,
      });
    }
    if (finalMessage.invalid > 0) {
      failures.push({
        gate: 'submit_clean',
        detail: `${finalMessage.invalid} JSON-only final message(s) failed validation`,
      });
    }
    const acceptedViaFinalMessage =
      submitCalls.succeeded === 0 && finalMessage.captured;
    if (submitCalls.succeeded !== 1 && !acceptedViaFinalMessage) {
      failures.push({
        gate: 'submit_clean',
        detail: `${submitToolName} had ${submitCalls.succeeded} successful call(s), expected exactly 1`,
      });
    }
    const attempts = await agent.tasks.listAttempts(taskId);
    const attempt = attempts.find((a) => a.attemptN === attemptN);
    if (!attempt) {
      failures.push({
        gate: 'submit',
        detail: `attempt ${attemptN} not found`,
      });
    } else if (attempt.status !== 'completed') {
      failures.push({
        gate: 'submit',
        detail: `attempt ${attemptN} status=${attempt.status}, expected completed`,
      });
    } else if (attempt.output === null) {
      failures.push({
        gate: 'submit',
        detail:
          'accepted attempt has no captured output (submit tool never succeeded)',
      });
    } else if (!Value.Check(outputSchema, attempt.output)) {
      const errors = formatTypeBoxErrors(outputSchema, attempt.output);
      failures.push({
        gate: 'output_schema',
        detail: `captured output is not a valid ${schemaName}: ${errors}`,
      });
    } else if (
      expected.outputContract &&
      validateOutputContractResult(
        'freeform',
        { outputContract: expected.outputContract },
        attempt.output,
      ).length > 0
    ) {
      failures.push({
        gate: 'output_contract',
        detail: 'captured result does not satisfy the scenario output contract',
      });
    } else if (
      (attempt.output as { verification?: unknown }).verification === undefined
    ) {
      // Create-time normalization ALWAYS injects a `submit-output` gate into a
      // producer task's successCriteria (see `normalizeTaskInputForCreate`), so
      // the producer runs WITH successCriteria and its output MUST carry a
      // `verification` record (both run_eval and freeform). Absent => contract
      // violation.
      failures.push({
        gate: 'verification_contract',
        detail:
          'output.verification is required (the auto-injected submit-output ' +
          'gate makes successCriteria present) but was absent',
      });
    }
  }

  // Gate: deterministic assertions on the submitted response string (the
  // task type's graded field — `response` for run_eval, `summary` for freeform).
  // Format/content checks belong here — never the LLM judge (which can't count
  // reliably). Each pattern is a RegExp source applied with no flags.
  if (gates.responseMustMatch?.length || gates.responseMustNotMatch?.length) {
    const attempts = await agent.tasks.listAttempts(taskId);
    const output = attempts.find((a) => a.attemptN === attemptN)?.output;
    const raw = (output as Record<string, unknown> | undefined)?.[
      responseField
    ];
    const response = typeof raw === 'string' ? raw : null;
    if (response === null) {
      failures.push({
        gate: 'response_content',
        detail: `accepted attempt has no string ${responseField} to assert against`,
      });
    } else {
      for (const src of gates.responseMustMatch ?? []) {
        if (!new RegExp(src).test(response)) {
          failures.push({
            gate: 'response_content',
            detail: `response did not match required pattern /${src}/`,
          });
        }
      }
      for (const src of gates.responseMustNotMatch ?? []) {
        if (new RegExp(src).test(response)) {
          failures.push({
            gate: 'response_content',
            detail: `response matched forbidden pattern /${src}/`,
          });
        }
      }
    }
  }

  // Gate: at least N artifacts were PERSISTED for the attempt. Checks the
  // artifact API (persistence), not the tool-call stream (invocation), so it
  // catches "the upload tool was called but nothing persisted".
  if (gates.requireArtifacts !== undefined) {
    if (!expected.teamId) {
      failures.push({
        gate: 'artifact_count',
        detail: 'requireArtifacts requires expected.teamId',
      });
    } else {
      const artifacts = await agent.tasks.artifacts.list(taskId, {
        teamId: expected.teamId,
      });
      const forAttempt = artifacts.filter(
        (a) => a.attemptN === null || a.attemptN === attemptN,
      );
      if (forAttempt.length < gates.requireArtifacts) {
        failures.push({
          gate: 'artifact_count',
          detail: `expected >= ${gates.requireArtifacts} persisted artifact(s), found ${forAttempt.length}`,
        });
      }
    }
  }

  // Gate (safety): no uploaded artifact may contain a forbidden pattern —
  // secrets, credentials, PII. Lists the attempt's artifacts, downloads each,
  // and scans the bytes. A match hard-fails the scenario (composite 0).
  if (gates.forbidArtifactContentMatching?.length) {
    if (!expected.teamId) {
      failures.push({
        gate: 'artifact_content',
        detail: 'forbidArtifactContentMatching requires expected.teamId',
      });
    } else {
      const patterns = gates.forbidArtifactContentMatching.map((src) => ({
        src,
        re: new RegExp(src),
      }));
      const artifacts = await agent.tasks.artifacts.list(taskId, {
        teamId: expected.teamId,
      });
      for (const artifact of artifacts) {
        // Artifacts not scoped to this attempt (attemptN null = task-level) are
        // still scanned; only skip ones stamped for a different attempt.
        if (artifact.attemptN !== null && artifact.attemptN !== attemptN) {
          continue;
        }
        const download = await agent.tasks.artifacts.download(
          { taskId, cid: artifact.cid },
          { teamId: expected.teamId },
        );
        const content = await readStreamText(download.stream);
        for (const { src, re } of patterns) {
          if (re.test(content)) {
            failures.push({
              gate: 'artifact_content',
              detail: `artifact "${artifact.title}" (cid ${artifact.cid}) matched forbidden pattern /${src}/`,
            });
          }
        }
      }
    }
  }

  return { passed: failures.length === 0, failures };
}
